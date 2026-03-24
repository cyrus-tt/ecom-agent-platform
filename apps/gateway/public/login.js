(function () {
  "use strict";

  const form = document.getElementById("loginForm");
  const userInput = document.getElementById("username");
  const passInput = document.getElementById("password");
  const submitBtn = document.getElementById("submitBtn");
  const errorMsg = document.getElementById("errorMsg");

  const next = normalizeNext(new URLSearchParams(window.location.search).get("next"));

  checkAlreadyLoggedIn();
  if (passInput) {
    passInput.focus();
  }

  if (form) {
    form.addEventListener("submit", onSubmit);
  }

  async function checkAlreadyLoggedIn() {
    try {
      const resp = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        window.location.replace(normalizeNext(next || data.preferred_route || "/"));
      }
    } catch (_err) {
      // ignore
    }
  }

  function normalizeNext(raw) {
    const value = String(raw || "").trim();
    if (!value || !value.startsWith("/") || value.startsWith("//")) {
      return "/";
    }
    return value;
  }

  function setError(text) {
    if (errorMsg) {
      errorMsg.textContent = text || "";
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    if (!submitBtn) {
      return;
    }
    if (!userInput || !String(userInput.value || "").trim()) {
      setError("登录配置异常，缺少固定用户名");
      return;
    }
    submitBtn.disabled = true;

    try {
      const payload = {
        username: userInput.value.trim(),
        password: passInput ? passInput.value : "",
        next,
      };
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        throw new Error(data.message || "登录失败");
      }
      window.location.replace(normalizeNext(data.next || data.preferred_route || next || "/"));
    } catch (err) {
      setError(err && err.message ? err.message : "登录失败，请稍后重试");
    } finally {
      submitBtn.disabled = false;
    }
  }
})();
