import React, { useEffect, useRef, useState, type JSX } from "react";
import ReactDOM from "react-dom/client";
import useLocalStorageState from "use-local-storage-state";
import * as uuid from "uuid";

import { type Token } from "./logit-loom";
import * as TreeStore from "./tree-store";
import type { ApiInfo } from "./api-sniffer";

const possibleModelTypes = ["chat", "base"] as const;
type ModelType = (typeof possibleModelTypes)[number];
function coerceToModelType(maybeType: string | undefined): ModelType {
  const m = maybeType?.toLowerCase() ?? "chat";
  if (([...possibleModelTypes] as string[]).includes(m)) {
    return m as ModelType;
  }
  return "chat";
}
interface ApiPreset {
  id: string;
  presetName: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  modelType: ModelType;
}

function App(): JSX.Element {
  const [darkMode, setDarkMode] = useLocalStorageState<boolean>("darkMode", { defaultValue: false });

  const [baseUrl, setBaseUrl] = useLocalStorageState<string>("baseUrl");
  const [apiKey, setApiKey] = useLocalStorageState<string>("apiKey");
  const [modelName, setModelName] = useLocalStorageState<string>("modelName");
  const [_modelType, setModelType] = useLocalStorageState<"chat" | "base">("modelType", { defaultValue: "chat" });
  const modelType = coerceToModelType(_modelType);

  const [apiPresets, setApiPresets] = useLocalStorageState<ApiPreset[]>("apiPresets");
  const [currentPresetId, setCurrentPresetId] = useLocalStorageState<string>("currentPreset", {
    defaultValue: apiPresets?.[0]?.id ?? "",
  });

  const [systemPrompt, setSystemPrompt] = useLocalStorageState<string>("lastSystemPrompt");
  const [prompt, setPrompt] = useLocalStorageState<string>("lastPrompt");
  const [prefill, setPrefill] = useLocalStorageState<string>("lastPrefill");

  const [depth, setDepth] = useLocalStorageState<number>("depth", { defaultValue: 5 });
  const [width, setWidth] = useLocalStorageState<number>("maxWidth", { defaultValue: 3 });
  const [coverProb, setCoverProb] = useLocalStorageState<number>("coverProb", { defaultValue: 0.8 });

  const store = TreeStore.useTreeStore();
  const [foldedNodeIds, setFoldedNodeIds] = useLocalStorageState<string[]>("foldedNodes", { defaultValue: [] });
  useEffect(() => {
    TreeStore.loadTreeFromLocalStorage();
  }, []);

  return (
    <>
      <div className="sticky-footer">
        <div className="spinner" hidden={!store.running}></div>{" "}
        {store.value.kind === "error" && !store.running && <div className="error">{store.value.error.toString()}</div>}
      </div>
      <Settings>
        <DarkModeToggle darkMode={darkMode} setDarkMode={setDarkMode} />
        <TextSetting label="Base URL" type="text" value={baseUrl} onChange={setBaseUrl} />{" "}
        <TextSetting label="API Key" type="password" value={apiKey} onChange={setApiKey} />{" "}
        <TextSetting label="Model" type="text" value={modelName} onChange={setModelName} />{" "}
        <DropdownSetting
          label="Type"
          tooltip='Pick "chat" for instruct models, "base" for base (completion) models.'
          options={possibleModelTypes.map((v) => ({ id: v, text: v }))}
          value={modelType}
          onChange={(type) => {
            setModelType(coerceToModelType(type));
          }}
        />
        <EditPresetsButtonDialog
          currentValues={{
            baseUrl,
            apiKey,
            modelName,
          }}
          currentPresetId={currentPresetId}
          presets={apiPresets}
          setPresets={(presets) => setApiPresets(presets)}
          pickPreset={(preset) => {
            setBaseUrl(preset.baseUrl);
            setApiKey(preset.apiKey);
            setModelName(preset.modelName);
            setModelType(preset.modelType);
            setCurrentPresetId(preset.id);
          }}
        />
        {!!baseUrl && store.baseUrlApiInfoCache[baseUrl] != null && (
          <ShowAPIWarning apiInfo={store.baseUrlApiInfoCache[baseUrl]} modelName={modelName} modelType={modelType} />
        )}
      </Settings>
      <hr />
      <Settings>
        {modelType === "chat" && <PromptSetting label="System" value={systemPrompt} onChange={setSystemPrompt} />}{" "}
        <PromptSetting label="Prompt" value={prompt} onChange={setPrompt} />{" "}
        <PromptSetting label="Prefill" value={prefill} onChange={setPrefill} />
      </Settings>
      <hr />
      <Settings>
        <NumberSetting
          label="Depth"
          tooltip="Expand this many tokens deep."
          min={1}
          max={100}
          step={1}
          value={depth}
          onChange={setDepth}
        />{" "}
        <NumberSetting
          label="Max children"
          tooltip="Expand up to this many child tokens."
          min={1}
          max={100}
          step={1}
          value={width}
          onChange={setWidth}
        />{" "}
        <NumberSetting
          label="Top P"
          tooltip="Expand children until the cumulative probability reaches this value, or max children."
          min={0}
          max={100}
          step={5}
          value={(coverProb * 100) | 0}
          onChange={(v) => setCoverProb(v / 100)}
        />{" "}
        <button
          disabled={!baseUrl || !apiKey || !modelName || store.running}
          onClick={() => {
            if (!baseUrl || !apiKey || !modelName || store.running) {
              return;
            }
            TreeStore.run(store, {
              baseUrl,
              apiKey,
              modelName,
              modelType,
              systemPrompt,
              prompt,
              prefill,
              depth,
              maxWidth: width,
              coverProb,
            });
          }}
        >
          Run
        </button>{" "}
        <button hidden={!store.running} disabled={store.interrupting} onClick={TreeStore.interruptRun}>
          {store.interrupting ? "Stopping..." : "Stop"}
        </button>
        <SettingsSpacer />
        <TreeSaveLoadClearButtons
          store={store}
          modelName={modelName ?? ""}
          modelSettings={
            modelType === "chat"
              ? {
                  kind: modelType,
                  systemPrompt,
                  prompt,
                  prefill,
                }
              : {
                  kind: modelType,
                  prompt,
                  prefill,
                }
          }
          importSettings={(modelName, modelSettings) => {
            // TODO: this isn't a great idea right now bc we don't want to serialize the apiKey / baseUrl, which might be private
            // maybe we should instead pop something up saying that the tree was generated with a different model than currently selected
            // setModelName(modelName);
            // setModelType(modelSettings.kind);
            if (modelSettings.kind === "chat") {
              setSystemPrompt(modelSettings.systemPrompt);
            }
            setPrompt(modelSettings.prompt);
            setPrefill(modelSettings.prefill);
          }}
        />
      </Settings>
      <hr />
      <div id="tree-container">
        <Tree
          roots={store.value.roots ?? []}
          foldedNodeIds={foldedNodeIds}
          setFoldedNodeIds={setFoldedNodeIds}
          onClickAddPrefill={(id) => {
            const newPrefill = TreeStore.getTokenAndPrefix(store, id);
            if (newPrefill !== null) {
              setPrefill((prefill ?? "") + newPrefill);
            }
          }}
          expandDisabled={!baseUrl || !apiKey || !modelName || store.running}
          onClickExpandFromHere={(id) => {
            if (!baseUrl || !apiKey || !modelName || store.running) {
              return;
            }
            TreeStore.run(store, {
              baseUrl,
              apiKey,
              modelName,
              modelType,
              systemPrompt,
              prompt,
              prefill,
              depth,
              maxWidth: width,
              coverProb,
              fromNodeId: id,
            });
          }}
        />
      </div>
    </>
  );
}

// Tree UI

function Tree(props: {
  roots: Token[];
  foldedNodeIds: string[];
  setFoldedNodeIds: (ids: string[]) => void;
  onClickAddPrefill: (id: string) => void;
  expandDisabled: boolean;
  onClickExpandFromHere: (id: string) => void;
}): JSX.Element {
  return (
    <ol>
      {props.roots.map((c) => (
        <TreeNode
          key={c.id}
          node={c}
          parents={[]}
          siblings={props.roots}
          foldedNodeIds={props.foldedNodeIds}
          setFoldedNodeIds={props.setFoldedNodeIds}
          onClickAddPrefill={props.onClickAddPrefill}
          expandDisabled={props.expandDisabled}
          onClickExpandFromHere={props.onClickExpandFromHere}
        />
      ))}
    </ol>
  );
}

const TreeNode = React.memo(function TreeNode({
  node,
  parents,
  siblings,
  foldedNodeIds,
  setFoldedNodeIds,
  parentHasShortDownLine,
  onClickAddPrefill,
  expandDisabled,
  onClickExpandFromHere,
}: {
  node: Token;
  parents: Token[];
  siblings: Token[];
  foldedNodeIds: string[];
  setFoldedNodeIds: (ids: string[]) => void;
  parentHasShortDownLine?: boolean;
  onClickAddPrefill: (id: string) => void;
  expandDisabled: boolean;
  onClickExpandFromHere: (id: string) => void;
}): JSX.Element {
  // has a down line if any children
  const hasDownLine = node.children.length > 0;
  // ...but it's short if it's an only child or the last child
  const hasShortDownLine = hasDownLine && (siblings.length === 1 || siblings.at(-1) === node);
  // has a left line if it has a parent, and either
  // 1. parent doesn't have a short down line
  // 2. parent does have a short down line, but this is the first child
  const hasLeftLine = parents.length === 0 ? false : parentHasShortDownLine ? siblings[0] === node : true;

  const recoveredEmoji = tryRecoverBrokenEmoji([...parents, node]);

  const isFolded = foldedNodeIds.includes(node.id);

  const text = node.text.replaceAll(" ", "␣").replaceAll("\n", "↵");
  return (
    <li
      className={
        "tree-node" +
        (hasDownLine ? " has-down-line" : "") +
        (hasShortDownLine ? " has-short-down-line" : "") +
        (hasLeftLine ? " has-left-line" : "")
      }
    >
      <div className="tree-node-info">
        <span className="token">{node.children.length ? <strong>{text}</strong> : text}</span>{" "}
        {recoveredEmoji ? <span className="token-utf8">utf8: {recoveredEmoji.trim()}</span> : ""}{" "}
        <span className="prob">({(node.prob * 100).toFixed(2)}%)</span>{" "}
        <span className="extra">
          [{node.logprob.toFixed(4)}]{" "}
          {node.branchFinished != null && node.children.length === 0 && `<|${node.branchFinished}|>`}
        </span>{" "}
        {node.children.length > 0 && (
          <button
            className={"node-button" + (isFolded ? " node-button-always-visible" : "")}
            title={isFolded ? "Unfold node" : "Fold node"}
            onClick={() =>
              isFolded
                ? setFoldedNodeIds(foldedNodeIds.filter((id) => id !== node.id))
                : setFoldedNodeIds([...foldedNodeIds, node.id])
            }
          >
            {isFolded ? "↕️" : "🤏"}
          </button>
        )}{" "}
        <button className="node-button add-prefill" title="Add to prefill" onClick={() => onClickAddPrefill(node.id)}>
          📥
        </button>{" "}
        <button
          className="node-button expand-from-here"
          disabled={expandDisabled}
          title="Expand tree from here"
          onClick={() => onClickExpandFromHere(node.id)}
        >
          🌱
        </button>{" "}
      </div>
      {!!node.children.length && !isFolded && (
        <ol>
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              parents={[...parents, node]}
              siblings={node.children}
              foldedNodeIds={foldedNodeIds}
              setFoldedNodeIds={setFoldedNodeIds}
              parentHasShortDownLine={hasShortDownLine}
              onClickAddPrefill={onClickAddPrefill}
              expandDisabled={expandDisabled}
              onClickExpandFromHere={onClickExpandFromHere}
            />
          ))}
        </ol>
      )}
    </li>
  );
});

// Settings components

function DarkModeToggle(props: { darkMode: boolean; setDarkMode: (darkMode: boolean) => void }): JSX.Element {
  useEffect(() => {
    if (props.darkMode && !document.body.classList.contains("dark-mode")) {
      document.body.classList.add("dark-mode");
    }
  }, []);

  return (
    <button
      title="Toggle dark mode"
      onClick={() => {
        if (props.darkMode) {
          document.body.classList.remove("dark-mode");
          props.setDarkMode(false);
        } else {
          document.body.classList.add("dark-mode");
          props.setDarkMode(true);
        }
      }}
    >
      {props.darkMode ? "☀️" : "🌙"}
    </button>
  );
}

function Settings(props: { children?: React.ReactNode | undefined }): JSX.Element {
  return <div className="settings-container">{props.children}</div>;
}

function SettingsSpacer(): JSX.Element {
  return <div className="settings-spacer"></div>;
}

function TextSetting(props: {
  label: string;
  type: "text" | "password";
  value: string | undefined;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label style={!props.value ? { color: "rgb(128, 32, 32)" } : {}}>
      <span>{props.label}:</span> <TextSettingInput value={props.value} type={props.type} onChange={props.onChange} />
    </label>
  );
}

function TextSettingInput(props: {
  type: "text" | "password";
  value: string | undefined;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <input
      style={!props.value ? { backgroundColor: "rgb(228, 50, 50)" } : {}}
      placeholder="(required)"
      type={props.type}
      value={props.value}
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

function PromptSetting(props: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label>
      <span>{props.label}:</span>{" "}
      <textarea value={props.value} onChange={(e) => props.onChange(e.target.value)}></textarea>
    </label>
  );
}

const Tooltip = (props: { tooltip: string }) => <abbr title={props.tooltip}>(?)</abbr>;

function NumberSetting(props: {
  label: string;
  tooltip: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label>
      <span>{props.label}:</span>{" "}
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />{" "}
      <span>
        <Tooltip tooltip={props.tooltip} />
      </span>
    </label>
  );
}

function DropdownSetting(props: {
  label: string;
  tooltip: string;
  options: Array<{ id: string; text: string }>;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label>
      <span>{props.label}:</span>{" "}
      <DropdownSettingSelect options={props.options} value={props.value} onChange={props.onChange} />
      <span>
        <Tooltip tooltip={props.tooltip} />
      </span>
    </label>
  );
}

function DropdownSettingSelect(props: {
  options: Array<{ id: string; text: string }>;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      {props.options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.text}
        </option>
      ))}
    </select>
  );
}

// "Edit presets" dialog components

function EditPresetsButtonDialog(props: {
  currentValues: Partial<Omit<ApiPreset, "id" | "presetName">>;
  currentPresetId: string;
  presets: ApiPreset[] | undefined;
  setPresets: (presets: ApiPreset[]) => void;
  pickPreset: (preset: ApiPreset) => void;
}): JSX.Element {
  const modal = useRef<HTMLDialogElement | null>(null);
  const presets = props.presets ?? [];

  return (
    <>
      {presets.length > 0 && (
        <>
          <DropdownSetting
            label="Preset"
            tooltip="Saved Base URL / API key / Model preset. Use the Edit Presets button to add presets."
            options={presets.map((p) => ({ id: p.id, text: p.presetName }))}
            value={props.currentPresetId}
            onChange={(presetId) => {
              const preset = presets.find((p) => p.id === presetId);
              if (preset != null) {
                props.pickPreset(preset);
              }
            }}
          />{" "}
        </>
      )}
      <button
        onClick={() => {
          modal.current?.showModal();
        }}
      >
        Edit presets
      </button>

      <dialog
        id="edit-presets"
        ref={modal}
        onCancel={() => {
          modal.current?.close();
        }}
      >
        <header>
          <strong>Edit API Presets</strong>
          <button
            onClick={() => {
              modal.current?.close();
            }}
          >
            ✕
          </button>
        </header>
        <main>
          <div id="preset-dialog-buttons">
            <button
              onClick={() => {
                props.setPresets([
                  {
                    id: uuid.v4(),
                    presetName: "",
                    baseUrl: "",
                    apiKey: "",
                    modelName: "",
                    modelType: "chat",
                  },
                  ...presets,
                ]);
              }}
            >
              Add new preset
            </button>
            <button
              onClick={() => {
                props.setPresets([
                  {
                    id: uuid.v4(),
                    presetName: "",
                    baseUrl: props.currentValues.baseUrl ?? "",
                    apiKey: props.currentValues.apiKey ?? "",
                    modelName: props.currentValues.modelName ?? "",
                    modelType: props.currentValues.modelType ?? "chat",
                  },
                  ...presets,
                ]);
              }}
            >
              Import current settings as preset
            </button>
          </div>
          <hr />
          <span>Preset Name</span>
          <span>Base URL</span>
          <span>API Key</span>
          <span>Model</span>
          <span>Type</span>
          <span></span>
          {presets.map((preset) => (
            <EditPresetsDialogRow
              key={preset.id}
              preset={preset}
              onChange={(newPreset) => {
                props.setPresets(presets.map((p) => (p.id === newPreset.id ? newPreset : p)));
              }}
              deletePreset={() => {
                props.setPresets(presets.filter((p) => p.id !== preset.id));
              }}
            />
          ))}
        </main>
      </dialog>
    </>
  );
}

function EditPresetsDialogRow(props: {
  preset: ApiPreset;
  onChange: (newPreset: ApiPreset) => void;
  deletePreset: () => void;
}): JSX.Element {
  const { presetName, baseUrl, apiKey, modelName, modelType } = props.preset;
  return (
    <>
      <TextSettingInput
        type="text"
        value={presetName}
        onChange={(newPresetName) => {
          props.onChange({ ...props.preset, presetName: newPresetName });
        }}
      />
      <TextSettingInput
        type="text"
        value={baseUrl}
        onChange={(newBaseUrl) => {
          props.onChange({ ...props.preset, baseUrl: newBaseUrl });
        }}
      />
      <TextSettingInput
        type="password"
        value={apiKey}
        onChange={(newApiKey) => {
          props.onChange({ ...props.preset, apiKey: newApiKey });
        }}
      />
      <TextSettingInput
        type="text"
        value={modelName}
        onChange={(newModelName) => {
          props.onChange({ ...props.preset, modelName: newModelName });
        }}
      />
      <DropdownSettingSelect
        options={possibleModelTypes.map((v) => ({ id: v, text: v }))}
        value={modelType}
        onChange={(newModelType) => {
          props.onChange({ ...props.preset, modelType: coerceToModelType(newModelType) });
        }}
      />
      <button
        onClick={() => {
          props.deletePreset();
        }}
      >
        Delete
      </button>
    </>
  );
}

// Api warning text (detected provider etc)

function ShowAPIWarning({
  apiInfo,
  modelName,
  modelType,
}: {
  apiInfo: ApiInfo;
  modelName?: string;
  modelType: "chat" | "base";
}): JSX.Element {
  const modelIsSupported =
    apiInfo.onlySupportsModels == null || !modelName || apiInfo.onlySupportsModels.includes(modelName);

  const warnings: string[] = [];
  if (modelType === "chat" && apiInfo.supportsPrefill !== "yes") {
    warnings.push(
      apiInfo.supportsPrefill === "no"
        ? "This provider doesn't support assistant prefill, which is required by LogitLoom"
        : "This provider may not support assistant prefill for some/all models (tagged 'unknown')"
    );
  }
  if (apiInfo.supportsLogprobs !== "yes") {
    warnings.push(
      apiInfo.supportsLogprobs === "no"
        ? "This provider doesn't support logprobs, which are required by LogitLoom"
        : "This provider may not support logprobs for some/all models (tagged 'unknown')"
    );
  }
  if (!modelIsSupported) {
    warnings.push(`The model ${modelName} is not tagged as a supported model for this provider.`);
  }
  if (apiInfo.extraWarning != null) {
    warnings.push(apiInfo.extraWarning);
  }

  const sev = apiInfo.supportsPrefill === "no" || apiInfo.supportsLogprobs === "no" ? "❌ Critical" : "⚠️ Warning";

  return warnings.length === 0 ? (
    <div></div>
  ) : (
    <div className="api-warning">
      {sev}:{" "}
      <small>
        Detected provider <strong>{apiInfo.provider}</strong>.{" "}
        {warnings.length === 1 ? warnings[0] + "." : warnings.join(". ")}
      </small>
    </div>
  );
}

// Export / Load / Clear Tree buttons

function TreeSaveLoadClearButtons(props: {
  store: TreeStore.State;
  modelName: string;
  modelSettings: TreeStore.SerializedModelSettings;
  importSettings: (modelName: string, modelSettings: TreeStore.SerializedModelSettings) => void;
}): JSX.Element {
  return (
    <div id="tree-save-load-clear-buttons">
      <span>Tree:</span>
      <SaveButton
        disabled={props.store.running}
        store={props.store}
        modelName={props.modelName}
        modelSettings={props.modelSettings}
      />
      <LoadButton disabled={props.store.running} importSettings={props.importSettings} />
      <ClearButton disabled={props.store.running} />
    </div>
  );
}

function SaveButton(props: {
  store: TreeStore.State;
  disabled: boolean;
  modelName: string;
  modelSettings: TreeStore.SerializedModelSettings;
}): JSX.Element {
  return (
    <button
      disabled={props.disabled}
      onClick={() => {
        TreeStore.saveTree(props.store, props.modelName, props.modelSettings);
      }}
    >
      Save
    </button>
  );
}

function LoadButton(props: {
  disabled: boolean;
  importSettings: (modelName: string, modelSettings: TreeStore.SerializedModelSettings) => void;
}): JSX.Element {
  return (
    <button
      disabled={props.disabled}
      onClick={() => {
        TreeStore.loadTree(props.importSettings);
      }}
    >
      Load
    </button>
  );
}

function ClearButton(props: { disabled: boolean }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      disabled={props.disabled}
      onClick={() => {
        // this component will never unmount, so no timeout leaks
        if (confirming) {
          TreeStore.setTree([]);
          setConfirming(false);
        } else {
          setConfirming(true);
          setTimeout(() => {
            setConfirming(false);
          }, 5000);
        }
      }}
    >
      {confirming ? "Are you sure?" : "Clear"}
    </button>
  );
}

// Broken UTF-8 chip helpers

/**
 * Try to fix broken emoji sequences, e.g. { text: "\\x20\\xf0\\x9f\\x8c", ... },
 * which may be spread over multiple tokens.
 **/
function tryRecoverBrokenEmoji(tokens: Token[]): string | null {
  if (!tokens.length || !looksLikeEscapedUtf8(tokens.at(-1)!.text, false)) {
    return null;
  }

  const mask = tokens.map((t) => looksLikeEscapedUtf8(t.text, false));
  // token position where every token after looks like broken utf-8
  // [false, true, false, true, true]
  //                      ^ start
  const start = mask.findIndex((_, idx) => mask.slice(idx, mask.length).every((v) => v));

  for (let i = start; i < tokens.length; i++) {
    const joined = tokens
      .slice(start, tokens.length)
      .map((t) => t.text)
      .join("");
    if (looksLikeEscapedUtf8(joined, true)) {
      const decoded = decodeEscapedUtf8(joined);
      if (decoded != null) {
        return decoded;
      }
    }
  }
  return null;
}

function looksLikeEscapedUtf8(s: string, strict: boolean): boolean {
  const wholeEscape = s.match(/^(\\x[0-9a-fA-F]{2})+$/g) !== null;
  if (strict) {
    return wholeEscape;
  }
  // also allow \\x -> aa split escapes
  return wholeEscape || s.match(/^((\\x)?[0-9a-fA-F]{1,2}|\\x)$/g) !== null;
}

function decodeEscapedUtf8(s: string): string | null {
  let rawBytes = "";
  s.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => (rawBytes += String.fromCharCode(parseInt(hex, 16))));

  const bytes = Uint8Array.from(rawBytes, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    return null;
  }
}

// Mount app

document.addEventListener("DOMContentLoaded", () => {
  const appDiv = document.querySelector("#app");
  if (!appDiv) {
    throw new Error("Missing #app div");
  }

  ReactDOM.createRoot(appDiv).render(<App />);
});
