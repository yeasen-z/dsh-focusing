(() => {
  let declaration;
  let Workbench;
  let slotProps = {};
  let capabilities = {};
  const React = window.preactCompat;
  const translations = { zh: {}, en: {} };
  const listeners = new Set();
  const locale = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";

  window.__ModuleLoader__ = { load(value) { declaration = value; } };

  async function workspaceAction(action, payload = {}) {
    const response = await fetch("/api/v1/workspace/action", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) throw new Error(body.detail || body.reason || `HTTP ${response.status}`);
    return body;
  }

  const uiWorkspace = {
    openSession(id) {
      if (capabilities.canOpenSession === false) return;
      workspaceAction("open", { id }).catch(error => console.warn("focusing: cannot open session", error));
    },
    startSession(workspace, options = {}) {
      if (capabilities.canStartDraft === false) return false;
      void workspaceAction("draft", { workspace, options }).catch(error => console.warn("focusing: cannot start draft", error));
      return true;
    },
    async forkSession(id) {
      const result = await workspaceAction("fork", { id });
      return result.sessionId;
    },
  };

  function showBootError(error) {
    const root = document.getElementById("root");
    const card = document.createElement("section");
    card.className = "standalone-error";
    const title = document.createElement("h1");
    title.textContent = "Focusing 启动失败";
    const detail = document.createElement("pre");
    detail.textContent = String(error?.stack || error?.message || error);
    card.append(title, detail);
    root.replaceChildren(card);
  }

  window.focusingStart = async () => {
    try {
      capabilities = await fetch("/api/v1/capabilities", { credentials: "same-origin" }).then(async response => {
        const body = await response.json();
        if (!response.ok || body.ok === false) throw new Error(body.detail || body.reason || `HTTP ${response.status}`);
        return body.capabilities;
      });
      const api = declaration.factory(name => {
        if (name === "react") return React;
        throw new Error(`Unknown browser module: ${name}`);
      });
      const ctx = {
        locale: {
          bind: () => key => translations[locale][key] ?? key,
          register: (_ns, language, table) => { Object.assign(translations[language], table); return () => {}; },
          subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        },
        effect: fn => fn(),
        get: name => name === "uiWorkspace" ? uiWorkspace : undefined,
        slots: {
          inject: (_owner, register) => register(),
          register: (options, component) => {
            if (options.name === "focusing.panel.body") {
              Workbench = component;
              slotProps = { ...slotProps, ...(options.inject?.() ?? {}) };
            }
            return () => {};
          },
        },
      };
      api.apply(ctx);
      if (!Workbench) throw new Error("The Focusing Workbench did not register its page");
      const root = document.getElementById("root");
      const page = React.createElement(
        "div",
        { className: "fz-host", style: { position: "relative", height: "100%", minHeight: 0 } },
        React.createElement(Workbench, { ...slotProps, capabilities }),
      );
      if (React.createRoot) React.createRoot(root).render(page);
      else window.preact.render(page, root);
    } catch (error) {
      showBootError(error);
    }
  };
})();
