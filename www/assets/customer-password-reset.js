/* Shared customer password reset. Challenge IDs, codes and proofs stay in memory only. */
function createCustomerPasswordReset({ request, openModal, closeModal, clearCustomerAuth }) {
  const modal = document.getElementById("customerPasswordResetModal");
  const form = document.getElementById("customerPasswordResetForm");
  const email = document.getElementById("customerResetEmail");
  const code = document.getElementById("customerResetCode");
  const password = document.getElementById("customerResetPassword");
  const confirmation = document.getElementById("customerResetPasswordConfirm");
  const resend = document.getElementById("customerResetResend");
  const back = document.getElementById("customerResetBack");
  const submit = document.getElementById("customerResetSubmit");
  const notice = document.getElementById("customerResetNotice");
  let state = {};
  let busy = false;

  const copy = () => ({
    de: { titles: ["Passwort zurücksetzen", "Code bestätigen", "Neues Passwort"], intros: ["Geben Sie die E-Mail-Adresse Ihres Kundenkontos ein.", "Geben Sie den sechsstelligen Code aus Ihrer E-Mail ein.", "Legen Sie ein neues Passwort für Ihr Kundenkonto fest."], submit: ["Code senden", "Code bestätigen", "Passwort speichern"], back: "Zurück", resend: "Code erneut senden", wait: "Erneut senden in", accepted: "Falls ein aktives Kundenkonto existiert, wurde ein Code versendet.", enterCode: "Bitte geben Sie den sechsstelligen Code ein.", passwordMismatch: "Die Passwörter stimmen nicht überein.", passwordLength: "Das Passwort muss 8 bis 128 Zeichen lang sein.", complete: "Das Passwort wurde geändert. Melden Sie sich mit dem neuen Passwort an.", unavailable: "Die Passwort-Zurücksetzung ist derzeit nicht verfügbar." },
    en: { titles: ["Reset password", "Confirm code", "New password"], intros: ["Enter the email address for your customer account.", "Enter the six-digit code from your email.", "Choose a new password for your customer account."], submit: ["Send code", "Confirm code", "Save password"], back: "Back", resend: "Resend code", wait: "Resend in", accepted: "If an active customer account exists, a code has been sent.", enterCode: "Enter the six-digit code.", passwordMismatch: "The passwords do not match.", passwordLength: "Password must be 8 to 128 characters long.", complete: "Your password was changed. Sign in with the new password.", unavailable: "Password reset is currently unavailable." },
    ar: { titles: ["استعادة كلمة المرور", "تأكيد الرمز", "كلمة مرور جديدة"], intros: ["أدخلي بريد حساب الزبون.", "أدخلي الرمز المكون من ستة أرقام من بريدك.", "اختاري كلمة مرور جديدة لحساب الزبون."], submit: ["إرسال الرمز", "تأكيد الرمز", "حفظ كلمة المرور"], back: "رجوع", resend: "إعادة إرسال الرمز", wait: "إعادة الإرسال بعد", accepted: "إذا كان هناك حساب زبون نشط، فقد تم إرسال رمز.", enterCode: "أدخلي الرمز المكون من ستة أرقام.", passwordMismatch: "كلمتا المرور غير متطابقتين.", passwordLength: "يجب أن تتكون كلمة المرور من 8 إلى 128 حرفاً.", complete: "تم تغيير كلمة المرور. سجلي الدخول بكلمة المرور الجديدة.", unavailable: "استعادة كلمة المرور غير متاحة حالياً." }
  }[document.documentElement.lang] || null) || {
    titles: ["Reset password", "Confirm code", "New password"], intros: ["Enter your customer email.", "Enter the six-digit code.", "Choose a new password."], submit: ["Send code", "Confirm code", "Save password"], back: "Back", resend: "Resend code", wait: "Resend in", accepted: "If an active customer account exists, a code has been sent.", enterCode: "Enter the six-digit code.", passwordMismatch: "The passwords do not match.", passwordLength: "Password must be 8 to 128 characters long.", complete: "Your password was changed. Sign in with the new password.", unavailable: "Password reset is unavailable."
  };

  function showMessage(text, error = false) {
    notice.textContent = text;
    notice.classList.toggle("error", error);
    notice.classList.add("show");
  }

  function render() {
    const step = state.step || 1;
    const labels = copy();
    modal.querySelectorAll("[data-reset-step]").forEach(element => { element.hidden = Number(element.dataset.resetStep) !== step; });
    document.getElementById("customerResetTitle").textContent = labels.titles[step - 1];
    document.getElementById("customerResetIntro").textContent = labels.intros[step - 1];
    submit.textContent = labels.submit[step - 1];
    submit.disabled = busy;
    back.textContent = labels.back;
    back.hidden = step === 1;
    const seconds = Math.max(0, Math.ceil(((state.resendAt || 0) - Date.now()) / 1000));
    resend.textContent = seconds ? `${labels.wait} ${seconds}s` : labels.resend;
    resend.disabled = busy || seconds > 0;
  }

  function reset() {
    state = { step: 1 };
    busy = false;
    form.reset();
    notice.classList.remove("show", "error");
    render();
  }

  async function send(path) {
    const payload = path === "request" ? { email: email.value.trim().toLowerCase() } : { challengeId: state.challengeId };
    const result = await request(`/api/v1/auth/password-reset/${path}`, { method: "POST", body: JSON.stringify(payload) });
    if (!result?.challengeId || result.status !== "accepted") throw new Error(copy().unavailable);
    state.challengeId = result.challengeId;
    state.resendAt = Date.parse(result.resendAvailableAt) || Date.now() + 60000;
    state.step = 2;
    code.value = "";
    showMessage(copy().accepted);
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    render();
    try {
      if (state.step === 1) {
        if (!email.reportValidity()) return;
        await send("request");
        code.focus();
      } else if (state.step === 2) {
        if (!/^\d{6}$/.test(code.value.trim())) { showMessage(copy().enterCode, true); return; }
        const result = await request("/api/v1/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({ challengeId: state.challengeId, code: code.value.trim() }) });
        if (!result?.resetToken) throw new Error(copy().unavailable);
        state.resetToken = result.resetToken;
        state.step = 3;
        code.value = "";
        notice.classList.remove("show", "error");
        password.focus();
      } else {
        if (password.value.length < 8 || password.value.length > 128) { showMessage(copy().passwordLength, true); return; }
        if (password.value !== confirmation.value) { showMessage(copy().passwordMismatch, true); return; }
        await request("/api/v1/auth/password-reset/complete", { method: "POST", body: JSON.stringify({ resetToken: state.resetToken, newPassword: password.value }) });
        clearCustomerAuth();
        reset();
        closeModal("customerPasswordResetModal");
        openModal("customerLoginModal");
        const loginNotice = document.getElementById("customerForgotNotice");
        if (loginNotice) { loginNotice.textContent = copy().complete; loginNotice.classList.add("show"); }
      }
    } catch (error) {
      showMessage(error.message || copy().unavailable, true);
    } finally {
      busy = false;
      render();
    }
  });

  resend.addEventListener("click", async () => {
    if (busy || !state.challengeId) return;
    busy = true; render();
    try { await send("resend"); } catch (error) { showMessage(error.message || copy().unavailable, true); }
    finally { busy = false; render(); }
  });
  back.addEventListener("click", () => {
    if (state.step === 3) { state.resetToken = null; state.step = 2; }
    else reset();
    notice.classList.remove("show", "error");
    render();
  });
  setInterval(render, 1000);
  reset();
  return { open: () => { reset(); openModal("customerPasswordResetModal"); email.focus(); }, reset };
}
