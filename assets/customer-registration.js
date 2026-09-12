/* Shared registration verification. Codes and proofs never persist in browser storage. */
function createCustomerRegistrationVerification({ request }) {
  const field = document.getElementById("customerVerifyCode");
  const box = document.getElementById("customerVerifyBox");
  const emailField = document.getElementById("customerRegisterEmail");
  const resend = document.getElementById("customerSendVerifyCode");
  const submit = document.getElementById("customerRegisterSubmit");
  const notice = document.getElementById("customerRegisterNotice");
  let state = {}, busy = false, version = 0;
  const copy = () => ({
    de: { code: "E-Mail-Bestätigungscode", resend: "Code erneut senden", accepted: "Der E-Mail-Anbieter hat den Versand angenommen. Bitte gib den Code aus deiner E-Mail ein.", enter: "Bitte gib den sechsstelligen Code ein.", unavailable: "Die E-Mail-Bestätigung ist derzeit nicht verfügbar.", wait: "Erneut senden in" },
    en: { code: "Email verification code", resend: "Resend code", accepted: "The email provider accepted the request. Enter the code from your email.", enter: "Enter the six-digit code.", unavailable: "Email verification is currently unavailable.", wait: "Resend in" },
    ar: { code: "رمز تأكيد البريد", resend: "إعادة إرسال الرمز", accepted: "قبل مزود البريد طلب الإرسال. أدخل الرمز من بريدك.", enter: "أدخل الرمز المكون من ستة أرقام.", unavailable: "تأكيد البريد غير متاح حالياً.", wait: "إعادة الإرسال بعد" }
  }[document.documentElement.lang] || { code: "Email verification code", resend: "Resend code", accepted: "The email provider accepted the request. Enter the code from your email.", enter: "Enter the six-digit code.", unavailable: "Email verification is unavailable.", wait: "Resend in" });
  function message(text) { notice.textContent = text; notice.classList.add("show"); }
  function refresh() {
    const seconds = Math.max(0, Math.ceil(((state.resendAt || 0) - Date.now()) / 1000));
    resend.disabled = busy || seconds > 0;
    resend.textContent = seconds ? `${copy().wait} ${seconds}s` : copy().resend;
    document.getElementById("customerVerifyLabel").textContent = copy().code;
    submit.disabled = busy;
  }
  function reset() { version++; state = {}; field.value = ""; box.style.display = "none"; refresh(); }
  emailField.addEventListener("input", reset);
  localStorage.removeItem("meshwarCustomerVerify");
  async function ensure(email, forceResend = false) {
    if (busy) return null;
    email = email.trim().toLowerCase();
    if (state.email !== email) { reset(); state.email = email; }
    const currentVersion = version;
    busy = true; refresh();
    let sending = false;
    try {
      if (state.token && state.tokenExpires > Date.now() && !forceResend) return state.token;
      if (!state.challengeId || forceResend || state.expiresAt <= Date.now() || state.token) {
        if (state.resendAt > Date.now()) return null;
        sending = true;
        const path = state.challengeId && !state.token ? "resend" : "request";
        const body = path === "resend" ? { challengeId: state.challengeId } : { email, channel: "EMAIL", purpose: "CUSTOMER_REGISTRATION" };
        state.resendAt = Date.now() + 60000;
        const result = await request(`/api/v1/auth/verification/${path}`, { method: "POST", body: JSON.stringify(body) });
        if (version !== currentVersion) return null;
        if (result?.status !== "accepted" || !result.challengeId) throw new Error(copy().unavailable);
        state = { email, challengeId: result.challengeId, expiresAt: Date.parse(result.expiresAt), resendAt: Date.parse(result.resendAvailableAt) };
        field.value = ""; box.style.display = "block"; message(copy().accepted); field.focus();
        return null;
      }
      if (!/^\d{6}$/.test(field.value.trim())) { message(copy().enter); return null; }
      const result = await request("/api/v1/auth/verification/confirm", { method: "POST", body: JSON.stringify({ challengeId: state.challengeId, code: field.value.trim() }) });
      if (version !== currentVersion) return null;
      if (!result?.verificationToken) throw new Error(copy().unavailable);
      state.token = result.verificationToken; state.tokenExpires = Date.parse(result.expiresAt); field.value = "";
      return state.token;
    } catch (error) {
      if (version === currentVersion) {
        message(error.message || copy().unavailable);
        box.style.display = "block";
        // Incorrect codes stay on this challenge; only an explicit resend sends mail.
        if (sending && Number(error.status) === 400) { state.challengeId = null; state.token = null; }
      }
      return null;
    } finally { busy = false; refresh(); }
  }
  resend.addEventListener("click", () => { if (emailField.reportValidity()) ensure(emailField.value, true); });
  setInterval(refresh, 1000);
  refresh();
  return { ensure, reset };
}
