import { useSyncExternalStore } from "react";
import OpenAI from "./openai";

import { buildTree, expandTree, pathToNodeWithId, type Token } from "./logit-loom";
import { type ApiInfo, sniffApi } from "./api-sniffer";
import * as SaveLoad from "./save-load";

export interface State {
  running: boolean;
  interrupting: boolean;
  value:
    | { kind: "tree"; roots: Token[] }
    | {
        kind: "error";
        error: any;
        /** The previous roots before the error, if they existed. */
        roots: Token[] | null;
      };
  baseUrlApiInfoCache: Record<string, ApiInfo>;
}

const { useTreeStore: _useTreeStore, updateState } = (() => {
  let listeners: Array<() => void> = [];
  let _state: State = {
    running: false,
    interrupting: false,
    value: { kind: "tree", roots: [] },
    baseUrlApiInfoCache: {},
  };

  function subscribe(listener: () => void): () => void {
    listeners = [...listeners, listener];
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }

  function emitChange() {
    for (let listener of listeners) {
      listener();
    }
  }

  function getSnapshot(): State {
    return _state;
  }

  return {
    useTreeStore: (): State => {
      return useSyncExternalStore(subscribe, getSnapshot);
    },
    updateState: (update: (oldState: State) => State): void => {
      const newState = update(_state);
      if (newState !== _state) {
        _state = newState;
        emitChange();
      }
    },
  };
})();

export const useTreeStore = _useTreeStore;

// Helper functions
// These functions should always take a state, instead of fetching state from the module. (This is why the current state is private.)
// The reason for this is if a component just uses one of these functions, it needs to have the state passed into it somehow (either via useTreeStore or as a prop)
// so that react knows to rerender it when the state changes. If the helper function pulls `state` directly, then react doesn't know about the dependency on state.
// Using `updateState` is fine, however.

/** Return the token string for a given token -- all the tokens before it, and itself, joined together. */
export function getTokenAndPrefix(state: State, id: string): string | null {
  if (state.value.roots == null) {
    return null;
  }
  const path = pathToNodeWithId(id, state.value.roots);
  if (path === null) {
    return null;
  }
  return path.map((t) => t.text).join("");
}

export function loadTreeFromLocalStorage() {
  updateState((state) => ({ ...state, value: { kind: "tree", roots: tryGetTreeFromLocalStorage() } }));
}

export function setTree(roots: Token[]) {
  updateState((state) => {
    if (state.running) {
      return state;
    }
    return { ...state, value: { kind: "tree", roots } };
  });
}

export type SerializedModelSettings = SaveLoad.SerializedTree["modelSettings"];

export function saveTree(state: State, modelName: string, modelSettings: SerializedModelSettings) {
  const roots = state.value.roots;
  if (state.running || roots == null) {
    return;
  }

  SaveLoad.saveTree({
    isLogitLoomTreeVersion: "logit-loom-tree-v1",
    modelName,
    modelSettings,
    roots,
  });
}

export function loadTree(importSettings: (modelName: string, modelSettings: SerializedModelSettings) => void) {
  SaveLoad.loadTree({
    onDone: (tree) => {
      updateState((state) => {
        if (state.running) {
          return state;
        }
        importSettings(tree.modelName, tree.modelSettings);
        return { ...state, value: { kind: "tree", roots: tree.roots } };
      });
    },
    onError: (error) => {
      updateState((state) => {
        if (state.running) {
          return state;
        }
        return { ...state, value: { kind: "error", error, roots: state.value.roots } };
      });
    },
    onCancel: () => {},
  });
}

export function interruptRun() {
  updateState((state) => {
    if (!state.running || state.interrupting) {
      return state;
    }
    return { ...state, interrupting: true };
  });
}

export function run(
  prevState: State,
  opts: {
    baseUrl: string;
    apiKey: string;
    modelName: string;
    modelType: "chat" | "base";
    systemPrompt: string | undefined;
    prompt: string | undefined;
    prefill: string | undefined;
    depth: number;
    maxWidth: number;
    coverProb: number;
    fromNodeId?: string;
  }
) {
  if (prevState.running) {
    return;
  }

  const client = new OpenAI({
    baseURL: opts.baseUrl,
    apiKey: opts.apiKey,
    dangerouslyAllowBrowser: true,
    // Remove headers that can cause CORS issues with non-openai providers
    // TODO remove only when provider !== openai, but nullifying headers with .create(request, { headers: nullifiedHeaders}) didn't work
    defaultHeaders: {
    'x-stainless-arch': null,
    'x-stainless-lang': null,
    'x-stainless-os': null,
    'x-stainless-package-version': null,
    'x-stainless-retry-count': null,
    'x-stainless-runtime': null,
    'x-stainless-runtime-version': null,
    'x-stainless-timeout': null,
    }
  });

  updateState((state) => ({ ...state, running: true }));

  async function getApiInfo(): Promise<ApiInfo> {
    if (!isProbablyLocalhost(opts.baseUrl)) {
      // don't *use* cache for localhost because it's liable to change if the user runs a new server
      // but we still store it for the UI to render warnings
      const cachedApiInfo = prevState.baseUrlApiInfoCache[opts.baseUrl];
      if (cachedApiInfo != null) {
        return cachedApiInfo;
      }
    }
    const apiInfo = await sniffApi(opts.baseUrl, opts.apiKey);
    updateState((state) => ({
      ...state,
      baseUrlApiInfoCache: { ...state.baseUrlApiInfoCache, [opts.baseUrl]: apiInfo },
    }));
    return apiInfo;
  }

  function progress(roots: Token[]) {
    trySyncTreeToLocalStorage(roots);
    // TODO: this is kinda gross, not supposed to smuggle values out of state like this, but it's OK because this isn't visible to react
    let interrupting = false;
    updateState((state) => {
      interrupting = state.interrupting;
      return { ...state, value: { kind: "tree", roots } };
    });
    return interrupting; // interrupt if user requested it
  }

  let promise: Promise<Token[]>;
  const fromNodeId = opts.fromNodeId;
  if (fromNodeId == null) {
    promise = getApiInfo().then((apiInfo) =>
      buildTree({
        client,
        baseUrl: opts.baseUrl,
        apiInfo,
        model: opts.modelName,
        modelType: opts.modelType,
        systemPrompt: opts.systemPrompt,
        prompt: opts.prompt,
        prefill: opts.prefill,
        depth: opts.depth,
        maxWidth: opts.maxWidth,
        coverProb: opts.coverProb,
        progress,
      })
    );
  } else {
    const roots = prevState.value.roots;
    if (roots == null) {
      throw new Error(`ui bug: state missing tree, can't expand '${opts.fromNodeId}' (how did you get this id?)`);
    }
    promise = getApiInfo().then((apiInfo) =>
      expandTree(
        {
          client,
          baseUrl: opts.baseUrl,
          apiInfo,
          model: opts.modelName,
          modelType: opts.modelType,
          systemPrompt: opts.systemPrompt,
          prompt: opts.prompt,
          prefill: opts.prefill,
          depth: opts.depth,
          maxWidth: opts.maxWidth,
          coverProb: opts.coverProb,
          progress,
        },
        roots,
        fromNodeId
      )
    );
  }

  promise
    .then((roots) => {
      trySyncTreeToLocalStorage(roots);
      updateState((state) => ({ ...state, value: { kind: "tree", roots }, running: false, interrupting: false }));
    })
    .catch((error) => {
      console.error(error);
      updateState((state) => ({
        ...state,
        running: false,
        interrupting: false,
        value: { kind: "error", error, roots: state.value.roots },
      }));
    });
}

// TODO: this was added before save-load.ts, but it would be nice to unify the mechanisms
const treeLocalStorageKey = "prevTree";

/** Get the previous tree from localStorage, or an empty tree on error / missing tree. */
function tryGetTreeFromLocalStorage(): Token[] {
  try {
    const value = localStorage.getItem(treeLocalStorageKey);
    if (value == null) {
      return [];
    }
    const tree = JSON.parse(value);
    if (!Array.isArray(tree)) {
      // TODO: basic validation, should really parse this with zod or something
      console.warn(`item in prevTree doesn't seem to be a tree?`, tree);
      return [];
    }
    console.log("loaded tree from localStorage:", tree);
    return tree as Token[];
  } catch (e) {
    console.error("getting tree from localStorage:", e);
    return [];
  }
}

/** Attempt to sync the tree to localStorage. */
function trySyncTreeToLocalStorage(roots: Token[]) {
  try {
    localStorage.setItem(treeLocalStorageKey, JSON.stringify(roots));
  } catch (e) {
    console.error("persisting tree to localStorage:", e);
  }
}

function isProbablyLocalhost(url: string): boolean {
  return (
    url.includes("//localhost") ||
    url.includes("//127.0.0") ||
    url.includes("//[::1]") ||
    url.includes("//[0:0:0:0:0:0:0:1]")
  );
}
