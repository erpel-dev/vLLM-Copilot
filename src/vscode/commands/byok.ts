import * as vscode from 'vscode';

/**
 * VS Code setting key for BYOK utility model default (introduced in 1.128).
 * Full path: chat.byokUtilityModelDefault
 * Section-scoped key (for use with getConfiguration('chat')): byokUtilityModelDefault
 */
const BYOK_UTILITY_MODEL_DEFAULT_SECTION_KEY = 'byokUtilityModelDefault';

/**
 * When set to 'mainAgent', VS Code will use the currently selected BYOK model
 * for both main chat and utility tasks (titles, commit messages, etc.).
 */
const MAIN_AGENT_BYOK_UTILITY_MODEL_DEFAULT = 'mainAgent';

/**
 * Ensure that `chat.byokUtilityModelDefault` is set to `'mainAgent'` so that
 * VS Code uses the selected BYOK model for utility flows (titles, commit
 * messages, intent detection). Without this, agent mode with MCP servers
 * (which triggers utility model resolution) fails with:
 * "No utility model is configured for 'copilot-utility-small' while the
 * selected main agent model is BYOK."
 *
 * This is idempotent — if already set, it does nothing.
 */
export async function ensureByokUtilityDefault(): Promise<void> {
  const chatConfig = vscode.workspace.getConfiguration('chat');
  const inspected = chatConfig.inspect(BYOK_UTILITY_MODEL_DEFAULT_SECTION_KEY);
  // The setting was introduced in VS Code 1.128. On older versions it is not a
  // registered configuration, so writing it throws "not a registered
  // configuration". A registered setting always reports a defaultValue; its
  // absence means this VS Code build doesn't know the setting — bail out.
  if (inspected?.defaultValue === undefined) return;
  // Only set if the user hasn't explicitly written it to settings.json.
  const hasExplicitValue =
    inspected.globalValue !== undefined ||
    inspected.workspaceValue !== undefined;
  if (!hasExplicitValue) {
    try {
      await chatConfig.update(
        BYOK_UTILITY_MODEL_DEFAULT_SECTION_KEY,
        MAIN_AGENT_BYOK_UTILITY_MODEL_DEFAULT,
        vscode.ConfigurationTarget.Global
      );
    } catch {
      // Not writable on this VS Code build — ignore (older versions).
    }
  }
}

/**
 * VS Code setting keys for the Agent Host (VS Code 1.135+, experimental). The
 * "Open in Agents" window runs Copilot-harness sessions in a separate Agent
 * Host process that does NOT see LanguageModelChatProvider models unless
 * BYOK/extension-provider models are explicitly allowed:
 * - `chat.agentHost.byokModels.enabled` — exposes provider models to agent-host
 *   sessions (docs: "AI language models in VS Code", BYOK note).
 * - `extensions.supportAgentsWindow` — opt-in map deciding which extensions
 *   activate inside the Agents window (docs: "Use the Agents window").
 * Both are gated on registration at runtime (absent on older builds). Current
 * VS Code versions synchronize BYOK model availability to a running Agent Host.
 */
const AGENT_HOST_BYOK_MODELS_SECTION_KEY = 'agentHost.byokModels.enabled';
const SUPPORT_AGENTS_WINDOW_SECTION_KEY = 'supportAgentsWindow';
/** Publisher-qualified id — must match package.json (publisher.name). */
const OUR_EXTENSION_ID = 'System-Sciences.vllm-copilot';

/**
 * Enable our models inside Agent Host sessions ("Open in Agents" window).
 *
 * The model-count guard belongs here because this helper runs at activation and
 * from the central models-setting change hook. Without at least one effective
 * model there is nothing to expose, and removal of the last model must not opt a
 * fresh profile into Agent Host support.
 *
 * Same rules as {@link ensureByokUtilityDefault}: unregistered setting on this
 * VS Code build → skip; the user has written an explicit value → respect it,
 * including an explicit `false` (that is an opt-out, not an oversight). For
 * `supportAgentsWindow` (a map), only OUR key is considered — other
 * extensions' entries are preserved, and only a missing entry is added.
 */
export async function ensureAgentHostModelsEnabled(): Promise<void> {
  const models = vscode.workspace.getConfiguration('vllm-copilot').get<unknown>('models');
  if (!Array.isArray(models) || models.length === 0) return;

  const chatConfig = vscode.workspace.getConfiguration('chat');
  const byokInspected = chatConfig.inspect(AGENT_HOST_BYOK_MODELS_SECTION_KEY);
  // Absent defaultValue = this VS Code build doesn't know the setting (pre-1.135).
  if (
    byokInspected?.defaultValue !== undefined &&
    byokInspected.globalValue === undefined &&
    byokInspected.workspaceValue === undefined
  ) {
    try {
      await chatConfig.update(
        AGENT_HOST_BYOK_MODELS_SECTION_KEY,
        true,
        vscode.ConfigurationTarget.Global
      );
    } catch {
      // Not writable on this VS Code build — ignore.
    }
  }

  const extConfig = vscode.workspace.getConfiguration('extensions');
  const windowInspected = extConfig.inspect(SUPPORT_AGENTS_WINDOW_SECTION_KEY);
  if (windowInspected?.defaultValue !== undefined) {
    const current =
      extConfig.get<Record<string, boolean>>(SUPPORT_AGENTS_WINDOW_SECTION_KEY) ?? {};
    if (current[OUR_EXTENSION_ID] === undefined) {
      try {
        await extConfig.update(
          SUPPORT_AGENTS_WINDOW_SECTION_KEY,
          { ...current, [OUR_EXTENSION_ID]: true },
          vscode.ConfigurationTarget.Global
        );
      } catch {
        // Not writable on this VS Code build — ignore.
      }
    }
  }
}

/**
 * globalState key; the notice shows once per install, whatever the outcome.
 * v2 re-arms once for installs that saw the v1 text: v1 lacked the advice to
 * switch the chat back to Local, the only user-side fix for the hidden menus.
 */
const AGENT_HOST_NOTICE_FLAG = 'vllmCopilot.agentHostByokNotice.v2';/** globalState key for the new-picker explainer; shown once per install, to
 * every user — the redesign reaches everyone, not just Agent Host sessions. */
const NEW_PICKER_NOTICE_FLAG = 'vllmCopilot.newPickerNotice.v1';
/** README section holding the annotated picker picture the notice points at. */
const NEW_PICKER_GUIDE_URL = 'https://github.com/fuzzifikation/vLLM-Copilot#new-ui';

/**
 * One-time explainer for Copilot's redesigned model picker: models live under
 * the vLLM-Copilot tab behind the model chip, Model Mode / Output Length are
 * chips on each model row, and the chat's session selector must stay on
 * "Local". The redesign is invisible until you know where to click, and the
 * README carries the annotated picture — "Show Me" opens it. Shown to every
 * install exactly once, whatever the outcome, and last among the activation
 * notices so it does not stack on the Agent Host heads-up.
 */
export async function maybeShowNewPickerNotice(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<string>(NEW_PICKER_NOTICE_FLAG)) return;
  await context.globalState.update(NEW_PICKER_NOTICE_FLAG, 'seen');
  const choice = await vscode.window.showInformationMessage(
    'vLLM-Copilot: the Copilot model picker has a new UI. Your models are under the '
      + '"vLLM-Copilot" tab, opened from the model chip at the bottom of the chat input; '
      + 'Model Mode and Output Length are chips on each model\'s row. Keep the chat\'s session '
      + 'selector on "Local" — an Agent Host session hides those menus.',
    { title: 'Show Me' },
    { title: 'Got it', isCloseAffordance: true }
  );
  if (choice?.title === 'Show Me') {
    await vscode.env.openExternal(vscode.Uri.parse(NEW_PICKER_GUIDE_URL));
  }
}

/** Upstream report for the metadata the Agent Host bridge drops. */
const AGENT_HOST_BRIDGE_ISSUE_URL = 'https://github.com/microsoft/vscode/issues/340138';

/**
 * One-time notice about what an Agent Host session does to our picker entries.
 *
 * When a chat runs on the Agent Host (the Copilot CLI harness — including a
 * Local chat that conversation restore re-bound to it), VS Code does not render
 * the entry this extension published; it renders its own bridged copy of the
 * model, which carries the token budgets and capabilities but none of the
 * provider UI: the `configurationSchema` submenus (Model Mode, Output Length),
 * the status icon, and the price/warning lines all disappear. The saved values
 * still reach the request, so the model behaves correctly while the menus to
 * change it are gone — which users reliably read as our bug. Say it once, and
 * say how to escape: the session dropdown switching the chat back to Local
 * restores our own entry and its menus.
 *
 * Gated on the bridge actually being on (and on builds that register the
 * setting), and recorded as seen before the dialog opens: an informational
 * notice must never nag, not even if the window dies mid-dialog.
 */
export async function maybeShowAgentHostNotice(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<string>(AGENT_HOST_NOTICE_FLAG)) return;
  if (
    vscode.workspace
      .getConfiguration('chat')
      .get<boolean>(AGENT_HOST_BYOK_MODELS_SECTION_KEY) !== true
  ) {
    return;
  }

  await context.globalState.update(AGENT_HOST_NOTICE_FLAG, 'seen');
  const choice = await vscode.window.showInformationMessage(
    'vLLM-Copilot: chats running on an Agent Host session show VS Code\'s own copy of your models, '
      + 'which hides Model Mode, Output Length, the model icon and the price line. Switch the chat '
      + 'back to "Local" in its session dropdown (or start a new chat) to get them back — the '
      + 'README shows where: "Show Me". Saved values still apply — change them in Manage Models… '
      + '(upstream: microsoft/vscode#340138).',
    { title: 'Show Me' },
    { title: 'Open upstream issue' },
    { title: 'Got it', isCloseAffordance: true }
  );
  if (choice?.title === 'Show Me') {
    await vscode.env.openExternal(vscode.Uri.parse(NEW_PICKER_GUIDE_URL));
  }
  if (choice?.title === 'Open upstream issue') {
    await vscode.env.openExternal(vscode.Uri.parse(AGENT_HOST_BRIDGE_ISSUE_URL));
  }
}

/**
 * Register the "Configure Utility Model" command: choose between using the
 * main agent model, GitHub Copilot, or none for utility flows. Manual
 * counterpart to the auto-configuration above.
 */
export function registerConfigureUtilityModelCommand(
  output: vscode.OutputChannel
): vscode.Disposable {
  return vscode.commands.registerCommand('vllm-copilot.configureUtilityModel', async () => {
    const chatConfig = vscode.workspace.getConfiguration('chat');
    const current = chatConfig.get<string>(BYOK_UTILITY_MODEL_DEFAULT_SECTION_KEY);

    const pick = await vscode.window.showQuickPick(
      [
        {
          label: 'Main Agent Model',
          description: `Use the selected BYOK model for utility tasks (recommended)${current === MAIN_AGENT_BYOK_UTILITY_MODEL_DEFAULT ? ' ● Current' : ''}`,
          value: MAIN_AGENT_BYOK_UTILITY_MODEL_DEFAULT,
        },
        {
          label: 'GitHub Copilot',
          description: `Use Copilot's built-in utility models${current === 'copilot' ? ' ● Current' : ''}`,
          value: 'copilot',
        },
        {
          label: 'None',
          description: `No utility model (utility flows will fail with BYOK)${current === 'none' || !current ? ' ● Current' : ''}`,
          value: 'none',
        },
      ],
      {
        ignoreFocusOut: true,
        placeHolder: 'Select utility model behavior for BYOK models',
      }
    );

    if (!pick) return;

    await chatConfig.update(
      BYOK_UTILITY_MODEL_DEFAULT_SECTION_KEY,
      pick.value,
      vscode.ConfigurationTarget.Global
    );

    output.appendLine(`[INFO] BYOK utility model default set to '${pick.value}'`);
    vscode.window.showInformationMessage(
      `Utility model default: ${pick.label}`
    );
  });
}
