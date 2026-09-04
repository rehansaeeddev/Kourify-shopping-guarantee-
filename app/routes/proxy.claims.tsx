import type { LoaderFunctionArgs } from "react-router";

import db from "../db.server";
import { ALL_ISSUE_TYPES } from "../lib/claim-issue-type";
import {
  getClaimTranslations,
  normalizeLocale,
  t,
  type LocaleBundle,
} from "../lib/claim-i18n";
import { authenticate } from "../shopify.server";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { liquid, session } = await authenticate.public.appProxy(request);

  const [settings, translations] = await Promise.all([
    session
      ? db.merchantSettings.findUnique({ where: { shop: session.shop } })
      : Promise.resolve(null),
    session
      ? getClaimTranslations(session.shop)
      : Promise.resolve({
          locales: {} as Record<string, LocaleBundle>,
          fallback: "en",
        }),
  ]);

  const { locales, fallback } = translations;
  const localeCodes = Object.keys(locales);

  const requested = normalizeLocale(
    new URL(request.url).searchParams.get("locale") ?? fallback,
  );
  const initial = locales[requested] ? requested : fallback;
  const bundle = locales[initial] ?? locales[fallback] ?? locales.en;

  // Translate + escape one key for the initial server render.
  const T = (key: string) => escapeHtml(t(bundle, key));

  const enabledTypes =
    settings?.enabledClaimTypes.split(",").filter(Boolean) ??
    ALL_ISSUE_TYPES.map((type) => type.value);
  const issueOptions = enabledTypes
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}" data-i18n="issue.${escapeHtml(
          value,
        )}">${T(`issue.${value}`)}</option>`,
    )
    .join("");

  const languageSwitcher =
    localeCodes.length > 1
      ? `<label class="lang" aria-label="${T("lang.aria")}" data-i18n-aria="lang.aria"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.5 2.4 3.8 5.6 3.8 9s-1.3 6.6-3.8 9m0-18C9.5 5.4 8.2 8.6 8.2 12s1.3 6.6 3.8 9M3.5 9h17M3.5 15h17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><select data-lang>${localeCodes
          .map(
            (code) =>
              `<option value="${escapeHtml(code)}"${
                code === initial ? " selected" : ""
              }>${escapeHtml(locales[code].label)}</option>`,
          )
          .join("")}</select></label>`
      : "";

  // Injected dictionary drives client-side language switching (no reload).
  const injectedI18n = JSON.stringify({ locales, initial, fallback }).replaceAll(
    "<",
    "\\u003c",
  );

  const page = `<!doctype html>
<html lang="${escapeHtml(initial)}" dir="${bundle.direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${T("doc.title")}</title>
  <style>
    :root{color-scheme:light;--ink:#102a2a;--muted:#647473;--line:#dce9e6;--brand:#0b806f;--brand-dark:#075c51;--mint:#e7f8f4;--paper:#fff;--danger:#b42318}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 8% 0%,#dff7f0 0,transparent 32%),radial-gradient(circle at 95% 95%,#d8eee8 0,transparent 30%),#f4f8f7;color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}.shell{min-height:100vh;display:grid;grid-template-columns:minmax(280px,390px) minmax(0,720px);justify-content:center;align-items:center;gap:clamp(30px,6vw,90px);padding:42px}.story{padding:12px}.brand{display:inline-flex;align-items:center;gap:12px;color:var(--brand-dark);font-size:14px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.brand-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:14px;background:linear-gradient(145deg,var(--brand),#12a38d);box-shadow:0 12px 30px rgba(11,128,111,.25)}.story h1{max-width:520px;margin:38px 0 18px;font-family:Georgia,"Times New Roman",serif;font-size:clamp(40px,5vw,66px);line-height:1.02;letter-spacing:-.035em;font-weight:500}.story>p{max-width:460px;margin:0;color:var(--muted);font-size:17px;line-height:1.7}.promise{display:grid;gap:16px;margin-top:38px}.promise-item{display:flex;gap:13px;align-items:flex-start;font-size:14px;line-height:1.5}.promise-icon{display:grid;place-items:center;flex:0 0 28px;height:28px;border-radius:50%;background:var(--mint);color:var(--brand);font-weight:900}.panel{position:relative;overflow:hidden;background:rgba(255,255,255,.96);border:1px solid rgba(198,219,214,.8);border-radius:28px;box-shadow:0 30px 80px rgba(24,73,67,.14);padding:clamp(26px,5vw,52px)}.panel:before{content:"";position:absolute;inset:0 0 auto;height:5px;background:linear-gradient(90deg,var(--brand),#45c8b2)}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.eyebrow{margin:0 0 8px;color:var(--brand);font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.panel h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:36px;font-weight:500;letter-spacing:-.02em}.intro{margin:10px 0 0;color:var(--muted);font-size:14px;line-height:1.6}.lang{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;color:var(--brand-dark);border:1px solid #cadbd7;border-radius:10px;padding:7px 10px;background:#fbfdfc}.lang select{border:0;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:700;outline:none;cursor:pointer}.progress{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:30px 0 34px}.progress-item{position:relative;padding-top:14px;color:#8a9997;font-size:11px;font-weight:700}.progress-item:before{content:"";position:absolute;inset:0 0 auto;height:4px;border-radius:99px;background:#e6eeec}.progress-item.is-active,.progress-item.is-done{color:var(--brand-dark)}.progress-item.is-active:before,.progress-item.is-done:before{background:var(--brand)}.step{display:none;animation:enter .22s ease}.step.is-active{display:block}@keyframes enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.step h3{margin:0 0 6px;font-size:19px}.step-copy{margin:0 0 22px;color:var(--muted);font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.field{display:grid;gap:8px;margin-bottom:18px}.field.full{grid-column:1/-1}.field label,.field-label{font-size:12px;font-weight:800;color:#304744}.field input,.field select,.field textarea{width:100%;border:1px solid #cadbd7;border-radius:12px;background:#fbfdfc;color:var(--ink);font:inherit;font-size:14px;padding:13px 14px;outline:none;transition:border-color .15s,box-shadow .15s,background .15s}.field textarea{min-height:110px;resize:vertical}.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--brand);background:#fff;box-shadow:0 0 0 4px rgba(11,128,111,.11)}.hint{color:#7a8a88;font-size:11px;line-height:1.45}.upload{border:1px dashed #b8d2cc;border-radius:14px;background:#f7fbfa;padding:16px}.error{display:none;margin:0 0 18px;padding:12px 14px;border-radius:12px;background:#fff1f0;color:var(--danger);font-size:13px;line-height:1.45}.error.is-visible{display:block}.actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:26px;padding-top:22px;border-top:1px solid var(--line)}button{appearance:none;border:0;border-radius:12px;padding:12px 18px;font:inherit;font-size:13px;font-weight:800;cursor:pointer;transition:transform .15s,box-shadow .15s,opacity .15s}.primary{margin-left:auto;background:linear-gradient(135deg,var(--brand-dark),#109985);color:#fff;box-shadow:0 10px 24px rgba(11,128,111,.22)}.primary:hover{transform:translateY(-1px);box-shadow:0 14px 28px rgba(11,128,111,.28)}.secondary{background:#edf5f3;color:var(--brand-dark)}button:disabled{cursor:not-allowed;opacity:.55;transform:none}.review{display:grid;gap:10px}.review-row{display:flex;justify-content:space-between;gap:22px;padding:13px 0;border-bottom:1px solid var(--line);font-size:13px}.review-row span:first-child{color:var(--muted)}.review-row strong{text-align:end}.notice{margin-top:18px;padding:14px;border-radius:12px;background:var(--mint);color:#315b55;font-size:12px;line-height:1.55}.success{text-align:center;padding:30px 8px}.success-mark{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 20px;border-radius:50%;background:var(--mint);color:var(--brand);font-size:28px}.success h3{font-family:Georgia,"Times New Roman",serif;font-size:30px;font-weight:500;margin:0 0 10px}.success p{color:var(--muted);line-height:1.65}.legal{margin:20px 0 0;text-align:center;color:#869492;font-size:10px;line-height:1.5}[dir=rtl] .primary{margin-left:0;margin-right:auto}@media(max-width:900px){.shell{grid-template-columns:1fr;max-width:720px;margin:auto;padding:26px}.story{padding:6px}.story h1{margin-top:24px;font-size:42px}.promise{display:none}.panel{border-radius:22px}}@media(max-width:560px){.shell{padding:14px}.story>p{font-size:15px}.panel{padding:28px 20px}.panel h2{font-size:30px}.grid{grid-template-columns:1fr}.progress-item{font-size:0}.progress-item:after{content:attr(data-short);font-size:10px}.actions{position:sticky;bottom:0;background:var(--paper);padding-bottom:2px}.review-row{display:grid;gap:5px}.review-row strong{text-align:start}}
  </style>
</head>
<body>
  <main class="shell">
    <section class="story" aria-labelledby="page-title">
      <div class="brand"><span class="brand-mark" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2 4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3Z" fill="#fff"/><path d="m8.2 12.1 2.3 2.3 5.2-5.1" stroke="#087466" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span data-i18n="brand">${T("brand")}</span></div>
      <h1 id="page-title" data-i18n="hero.title">${T("hero.title")}</h1>
      <p data-i18n="hero.subtitle">${T("hero.subtitle")}</p>
      <div class="promise">
        <div class="promise-item"><span class="promise-icon">✓</span><span><strong data-i18n="promise.secure.title">${T("promise.secure.title")}</strong><br><span data-i18n="promise.secure.body">${T("promise.secure.body")}</span></span></div>
        <div class="promise-item"><span class="promise-icon">✓</span><span><strong data-i18n="promise.human.title">${T("promise.human.title")}</strong><br><span data-i18n="promise.human.body">${T("promise.human.body")}</span></span></div>
        <div class="promise-item"><span class="promise-icon">✓</span><span><strong data-i18n="promise.comms.title">${T("promise.comms.title")}</strong><br><span data-i18n="promise.comms.body">${T("promise.comms.body")}</span></span></div>
      </div>
    </section>

    <section class="panel" aria-labelledby="claim-title">
      <div class="panel-head">
        <div>
          <p class="eyebrow" data-i18n="panel.eyebrow">${T("panel.eyebrow")}</p>
          <h2 id="claim-title" data-i18n="panel.title">${T("panel.title")}</h2>
        </div>
        ${languageSwitcher}
      </div>
      <p class="intro" data-i18n="panel.intro">${T("panel.intro")}</p>

      <div class="progress" data-i18n-aria="progress.aria" aria-label="${T("progress.aria")}">
        <div class="progress-item is-active" data-progress="0" data-i18n="progress.order" data-i18n-short="progress.order.short" data-short="${T("progress.order.short")}">${T("progress.order")}</div>
        <div class="progress-item" data-progress="1" data-i18n="progress.contact" data-i18n-short="progress.contact.short" data-short="${T("progress.contact.short")}">${T("progress.contact")}</div>
        <div class="progress-item" data-progress="2" data-i18n="progress.issue" data-i18n-short="progress.issue.short" data-short="${T("progress.issue.short")}">${T("progress.issue")}</div>
        <div class="progress-item" data-progress="3" data-i18n="progress.review" data-i18n-short="progress.review.short" data-short="${T("progress.review.short")}">${T("progress.review")}</div>
      </div>

      <div class="error" role="alert" data-error></div>
      <form data-claim-form novalidate>
        <div class="step is-active" data-step="0">
          <h3 data-i18n="step.order.title">${T("step.order.title")}</h3>
          <p class="step-copy" data-i18n="step.order.copy">${T("step.order.copy")}</p>
          <div class="grid">
            <div class="field"><label for="orderNumber" data-i18n="field.orderNumber">${T("field.orderNumber")}</label><input id="orderNumber" name="orderNumber" placeholder="#1234" autocomplete="off" required></div>
            <div class="field"><label for="confirmationCode" data-i18n="field.confirmationCode">${T("field.confirmationCode")}</label><input id="confirmationCode" name="confirmationCode" placeholder="e.g. AB12CD34" autocomplete="off"></div>
          </div>
        </div>

        <div class="step" data-step="1">
          <h3 data-i18n="step.contact.title">${T("step.contact.title")}</h3>
          <p class="step-copy" data-i18n="step.contact.copy">${T("step.contact.copy")}</p>
          <div class="grid">
            <div class="field"><label for="fullName" data-i18n="field.fullName">${T("field.fullName")}</label><input id="fullName" name="fullName" autocomplete="name" required></div>
            <div class="field"><label for="email" data-i18n="field.email">${T("field.email")}</label><input id="email" name="email" type="email" autocomplete="email" required></div>
          </div>
        </div>

        <div class="step" data-step="2">
          <h3 data-i18n="step.issue.title">${T("step.issue.title")}</h3>
          <p class="step-copy" data-i18n="step.issue.copy">${T("step.issue.copy")}</p>
          <div class="field"><label for="issueType" data-i18n="field.issue">${T("field.issue")}</label><select id="issueType" name="issueType">${issueOptions}</select></div>
          <div class="field"><label for="details" data-i18n="field.details">${T("field.details")}</label><textarea id="details" name="details" data-i18n-ph="field.details.placeholder" placeholder="${T("field.details.placeholder")}"></textarea></div>
          <div class="field upload" data-evidence-wrap hidden><label for="evidence" data-i18n="field.evidence">${T("field.evidence")}</label><input id="evidence" name="evidence" type="file" accept="image/*"><span class="hint" data-i18n="field.evidence.hint">${T("field.evidence.hint")}</span></div>
        </div>

        <div class="step" data-step="3">
          <h3 data-i18n="step.review.title">${T("step.review.title")}</h3>
          <p class="step-copy" data-i18n="step.review.copy">${T("step.review.copy")}</p>
          <div class="review" data-review></div>
          <div class="notice" data-i18n="notice">${T("notice")}</div>
        </div>

        <div class="actions" data-actions>
          <button class="secondary" type="button" data-back data-i18n="action.back" hidden>${T("action.back")}</button>
          <button class="primary" type="button" data-next>${T("action.continue")}</button>
        </div>
      </form>
      <p class="legal" data-i18n="legal">${T("legal")}</p>
    </section>
  </main>

  <script>window.__I18N__=${injectedI18n};</script>
  <script>
    (function(){
      var I18N=window.__I18N__||{locales:{},initial:"en",fallback:"en"};
      function bundleFor(code){return I18N.locales[code]||I18N.locales[I18N.fallback]||I18N.locales.en||{strings:{},direction:"ltr"}}
      window.__DICT__=(bundleFor(I18N.initial).strings)||{};
      function tr(key){var d=window.__DICT__||{};return d[key]!=null?d[key]:key}
      var step=0;var maxBytes=5*1024*1024;var evidenceImage="";var requiredEvidence=["damaged","concealed"];
      var form=document.querySelector("[data-claim-form]");var next=document.querySelector("[data-next]");var back=document.querySelector("[data-back]");var error=document.querySelector("[data-error]");var wrap=document.querySelector("[data-evidence-wrap]");var evidence=document.querySelector("#evidence");var issue=document.querySelector("#issueType");var langSelect=document.querySelector("[data-lang]");
      function showError(message){error.textContent=message;error.classList.add("is-visible");error.scrollIntoView({behavior:"smooth",block:"center"})}
      function clearError(){error.textContent="";error.classList.remove("is-visible")}
      function values(){var data=new FormData(form);return{orderNumber:String(data.get("orderNumber")||"").trim(),confirmationCode:String(data.get("confirmationCode")||"").trim(),fullName:String(data.get("fullName")||"").trim(),email:String(data.get("email")||"").trim(),issueType:String(data.get("issueType")||""),details:String(data.get("details")||"").trim(),evidenceImage:evidenceImage}}
      function syncEvidence(){wrap.hidden=requiredEvidence.indexOf(issue.value)===-1}issue.addEventListener("change",syncEvidence);syncEvidence();
      evidence.addEventListener("change",function(){var file=evidence.files&&evidence.files[0];evidenceImage="";if(!file)return;if(file.size>maxBytes){evidence.value="";showError(tr("error.imageTooLarge"));return}var reader=new FileReader();reader.onload=function(){evidenceImage=String(reader.result||"");clearError()};reader.readAsDataURL(file)});
      function validate(){var data=values();if(step===0&&!data.orderNumber){showError(tr("error.orderRequired"));return false}if(step===1&&(!data.fullName||!data.email)){showError(tr("error.contactRequired"));return false}if(step===1&&!/^\\S+@\\S+\\.\\S+$/.test(data.email)){showError(tr("error.emailInvalid"));return false}if(step===2&&requiredEvidence.indexOf(data.issueType)!==-1&&!data.evidenceImage){showError(tr("error.photoRequired"));return false}clearError();return true}
      function renderReview(){var data=values();var label=issue.options[issue.selectedIndex]?issue.options[issue.selectedIndex].text:data.issueType;document.querySelector("[data-review]").innerHTML='<div class="review-row"><span>'+safe(tr("review.order"))+'</span><strong>'+safe(data.orderNumber)+'</strong></div><div class="review-row"><span>'+safe(tr("review.contact"))+'</span><strong>'+safe(data.fullName)+'<br>'+safe(data.email)+'</strong></div><div class="review-row"><span>'+safe(tr("review.issue"))+'</span><strong>'+safe(label)+'</strong></div>'}
      function safe(value){var node=document.createElement("div");node.textContent=value;return node.innerHTML}
      function render(){document.querySelectorAll("[data-step]").forEach(function(el){el.classList.toggle("is-active",Number(el.getAttribute("data-step"))===step)});document.querySelectorAll("[data-progress]").forEach(function(el){var i=Number(el.getAttribute("data-progress"));el.classList.toggle("is-active",i===step);el.classList.toggle("is-done",i<step)});back.hidden=step===0;next.textContent=step===3?tr("action.submit"):tr("action.continue");if(step===3)renderReview();clearError()}
      function applyLocale(code){var b=bundleFor(code);window.__DICT__=b.strings||{};var dict=window.__DICT__;document.documentElement.lang=code;document.documentElement.dir=b.direction||"ltr";if(dict["doc.title"])document.title=dict["doc.title"];document.querySelectorAll("[data-i18n]").forEach(function(el){var k=el.getAttribute("data-i18n");if(dict[k]!=null)el.textContent=dict[k]});document.querySelectorAll("[data-i18n-ph]").forEach(function(el){var k=el.getAttribute("data-i18n-ph");if(dict[k]!=null)el.setAttribute("placeholder",dict[k])});document.querySelectorAll("[data-i18n-aria]").forEach(function(el){var k=el.getAttribute("data-i18n-aria");if(dict[k]!=null)el.setAttribute("aria-label",dict[k])});document.querySelectorAll("[data-i18n-short]").forEach(function(el){var k=el.getAttribute("data-i18n-short");if(dict[k]!=null)el.setAttribute("data-short",dict[k])});render()}
      function submit(){var data=values();next.disabled=true;next.textContent=tr("state.submitting");fetch("/apps/kourify/claim",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}).then(function(response){return response.json().catch(function(){return{}}).then(function(json){return{ok:response.ok,json:json}})}).then(function(result){if(!result.ok)throw new Error(result.json.error||tr("error.submitFailed"));form.innerHTML='<div class="success"><div class="success-mark">✓</div><h3>'+safe(tr("success.title"))+'</h3><p>'+safe(tr("success.body")).replace(/\\{email\\}/g,function(){return safe(data.email)})+'</p></div>';document.querySelector(".progress").hidden=true;document.querySelector(".legal").hidden=true}).catch(function(reason){next.disabled=false;next.textContent=tr("action.submit");showError(reason.message||tr("error.generic"))})}
      next.addEventListener("click",function(){if(!validate())return;if(step===3){submit();return}step+=1;render()});back.addEventListener("click",function(){if(step>0){step-=1;render()}});
      if(langSelect){langSelect.addEventListener("change",function(){applyLocale(langSelect.value)})}
      render();
    })();
  </script>
</body>
</html>`;

  return liquid(page, { layout: false });
};
