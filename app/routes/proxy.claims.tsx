import type { LoaderFunctionArgs } from "react-router";

import db from "../db.server";
import { ALL_ISSUE_TYPES, issueTypeLabel } from "../lib/claim-issue-type";
import { authenticate } from "../shopify.server";

const FRENCH_COPY: Record<string, string> = {
  "File a claim · Kourify": "Déposer une réclamation · Kourify",
  "Protection that follows through.": "Une protection qui tient ses promesses.",
  "When delivery does not go as planned, tell us what happened. A real person will review your claim and follow up by email.":
    "Si la livraison ne se passe pas comme prévu, dites-nous ce qui s'est passé. Une personne examinera votre réclamation et vous répondra par e-mail.",
  "Secure verification": "Vérification sécurisée",
  "We match your details to the store order.":
    "Nous vérifions vos informations avec la commande.",
  "Human review": "Examen humain",
  "Every claim is considered individually.":
    "Chaque réclamation est examinée individuellement.",
  "Clear communication": "Communication claire",
  "Updates are sent to your order email.":
    "Les mises à jour sont envoyées à l'adresse e-mail de la commande.",
  "Shopping guarantee": "Garantie d'achat",
  "File a claim": "Déposer une réclamation",
  "Most submissions take only a few minutes.":
    "La plupart des demandes ne prennent que quelques minutes.",
  "Claim progress": "Progression de la réclamation",
  "Order info": "Commande",
  Contact: "Coordonnées",
  "Issue details": "Détails",
  Review: "Vérification",
  "Find your protected order": "Trouvez votre commande protégée",
  "Use the details shown in your confirmation email.":
    "Utilisez les informations de votre e-mail de confirmation.",
  "Order number": "Numéro de commande",
  "Confirmation code": "Code de confirmation",
  "How can we reach you?": "Comment pouvons-nous vous joindre ?",
  "Use the email attached to your Shopify order.":
    "Utilisez l'adresse e-mail associée à votre commande Shopify.",
  "Full name": "Nom complet",
  "Order email": "E-mail de la commande",
  "What happened?": "Que s'est-il passé ?",
  "Choose the closest match and share the useful details.":
    "Choisissez l'option la plus proche et ajoutez les détails utiles.",
  Issue: "Problème",
  Details: "Détails",
  "Photo evidence": "Preuve photographique",
  "Required for damaged or concealed-damage claims. Maximum 5 MB.":
    "Requise pour les dommages visibles ou cachés. Maximum 5 Mo.",
  "Review your claim": "Vérifiez votre réclamation",
  "Make sure these details are correct before submitting.":
    "Vérifiez ces informations avant l'envoi.",
  "Submitting a claim does not guarantee approval or an automatic payout. Kourify reviews each claim under the merchant's configured protection terms.":
    "L'envoi d'une réclamation ne garantit ni son approbation ni un remboursement automatique. Kourify l'examine selon les conditions du marchand.",
  Back: "Retour",
  Continue: "Continuer",
  "Submit claim": "Envoyer la réclamation",
  "Your information is used only to verify and review this protection claim.":
    "Vos informations servent uniquement à vérifier et examiner cette réclamation.",
  "Never arrived (lost in transit)": "Jamais arrivé (perdu en transit)",
  "Arrived damaged": "Arrivé endommagé",
  "Stolen after delivery": "Volé après la livraison",
  "Items missing from package": "Articles manquants",
  "Concealed damage": "Dommage caché",
  "Wrong item received": "Mauvais article reçu",
};

function localize(value: string, locale: string): string {
  return locale === "fr" ? (FRENCH_COPY[value] ?? value) : value;
}

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
  const requestedLocale = (
    new URL(request.url).searchParams.get("locale") ?? "en"
  )
    .toLowerCase()
    .split("-")[0];

  const settings = session
    ? await db.merchantSettings.findUnique({ where: { shop: session.shop } })
    : null;
  const availableLanguages = settings?.storefrontLanguages
    .split(",")
    .filter(Boolean) ?? ["en"];
  const locale = availableLanguages.includes(requestedLocale)
    ? requestedLocale
    : (settings?.storefrontFallbackLanguage ?? "en");
  const enabledTypes =
    settings?.enabledClaimTypes.split(",").filter(Boolean) ??
    ALL_ISSUE_TYPES.map((type) => type.value);
  const issueOptions = enabledTypes
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}">${escapeHtml(localize(issueTypeLabel(value), locale))}</option>`,
    )
    .join("");

  const page = `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>File a claim · Kourify</title>
  <style>
    :root{color-scheme:light;--ink:#102a2a;--muted:#647473;--line:#dce9e6;--brand:#0b806f;--brand-dark:#075c51;--mint:#e7f8f4;--paper:#fff;--danger:#b42318}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 8% 0%,#dff7f0 0,transparent 32%),radial-gradient(circle at 95% 95%,#d8eee8 0,transparent 30%),#f4f8f7;color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}.shell{min-height:100vh;display:grid;grid-template-columns:minmax(280px,390px) minmax(0,720px);justify-content:center;align-items:center;gap:clamp(30px,6vw,90px);padding:42px}.story{padding:12px}.brand{display:inline-flex;align-items:center;gap:12px;color:var(--brand-dark);font-size:14px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.brand-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:14px;background:linear-gradient(145deg,var(--brand),#12a38d);box-shadow:0 12px 30px rgba(11,128,111,.25)}.story h1{max-width:520px;margin:38px 0 18px;font-family:Georgia,"Times New Roman",serif;font-size:clamp(40px,5vw,66px);line-height:1.02;letter-spacing:-.035em;font-weight:500}.story>p{max-width:460px;margin:0;color:var(--muted);font-size:17px;line-height:1.7}.promise{display:grid;gap:16px;margin-top:38px}.promise-item{display:flex;gap:13px;align-items:flex-start;font-size:14px;line-height:1.5}.promise-icon{display:grid;place-items:center;flex:0 0 28px;height:28px;border-radius:50%;background:var(--mint);color:var(--brand);font-weight:900}.panel{position:relative;overflow:hidden;background:rgba(255,255,255,.96);border:1px solid rgba(198,219,214,.8);border-radius:28px;box-shadow:0 30px 80px rgba(24,73,67,.14);padding:clamp(26px,5vw,52px)}.panel:before{content:"";position:absolute;inset:0 0 auto;height:5px;background:linear-gradient(90deg,var(--brand),#45c8b2)}.eyebrow{margin:0 0 8px;color:var(--brand);font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.panel h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:36px;font-weight:500;letter-spacing:-.02em}.intro{margin:10px 0 0;color:var(--muted);font-size:14px;line-height:1.6}.progress{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:30px 0 34px}.progress-item{position:relative;padding-top:14px;color:#8a9997;font-size:11px;font-weight:700}.progress-item:before{content:"";position:absolute;inset:0 0 auto;height:4px;border-radius:99px;background:#e6eeec}.progress-item.is-active,.progress-item.is-done{color:var(--brand-dark)}.progress-item.is-active:before,.progress-item.is-done:before{background:var(--brand)}.step{display:none;animation:enter .22s ease}.step.is-active{display:block}@keyframes enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.step h3{margin:0 0 6px;font-size:19px}.step-copy{margin:0 0 22px;color:var(--muted);font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.field{display:grid;gap:8px;margin-bottom:18px}.field.full{grid-column:1/-1}.field label,.field-label{font-size:12px;font-weight:800;color:#304744}.field input,.field select,.field textarea{width:100%;border:1px solid #cadbd7;border-radius:12px;background:#fbfdfc;color:var(--ink);font:inherit;font-size:14px;padding:13px 14px;outline:none;transition:border-color .15s,box-shadow .15s,background .15s}.field textarea{min-height:110px;resize:vertical}.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--brand);background:#fff;box-shadow:0 0 0 4px rgba(11,128,111,.11)}.hint{color:#7a8a88;font-size:11px;line-height:1.45}.upload{border:1px dashed #b8d2cc;border-radius:14px;background:#f7fbfa;padding:16px}.error{display:none;margin:0 0 18px;padding:12px 14px;border-radius:12px;background:#fff1f0;color:var(--danger);font-size:13px;line-height:1.45}.error.is-visible{display:block}.actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:26px;padding-top:22px;border-top:1px solid var(--line)}button{appearance:none;border:0;border-radius:12px;padding:12px 18px;font:inherit;font-size:13px;font-weight:800;cursor:pointer;transition:transform .15s,box-shadow .15s,opacity .15s}.primary{margin-left:auto;background:linear-gradient(135deg,var(--brand-dark),#109985);color:#fff;box-shadow:0 10px 24px rgba(11,128,111,.22)}.primary:hover{transform:translateY(-1px);box-shadow:0 14px 28px rgba(11,128,111,.28)}.secondary{background:#edf5f3;color:var(--brand-dark)}button:disabled{cursor:not-allowed;opacity:.55;transform:none}.review{display:grid;gap:10px}.review-row{display:flex;justify-content:space-between;gap:22px;padding:13px 0;border-bottom:1px solid var(--line);font-size:13px}.review-row span:first-child{color:var(--muted)}.review-row strong{text-align:right}.notice{margin-top:18px;padding:14px;border-radius:12px;background:var(--mint);color:#315b55;font-size:12px;line-height:1.55}.success{text-align:center;padding:30px 8px}.success-mark{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 20px;border-radius:50%;background:var(--mint);color:var(--brand);font-size:28px}.success h3{font-family:Georgia,"Times New Roman",serif;font-size:30px;font-weight:500;margin:0 0 10px}.success p{color:var(--muted);line-height:1.65}.legal{margin:20px 0 0;text-align:center;color:#869492;font-size:10px;line-height:1.5}@media(max-width:900px){.shell{grid-template-columns:1fr;max-width:720px;margin:auto;padding:26px}.story{padding:6px}.story h1{margin-top:24px;font-size:42px}.promise{display:none}.panel{border-radius:22px}}@media(max-width:560px){.shell{padding:14px}.story>p{font-size:15px}.panel{padding:28px 20px}.panel h2{font-size:30px}.grid{grid-template-columns:1fr}.progress-item{font-size:0}.progress-item:after{content:attr(data-short);font-size:10px}.actions{position:sticky;bottom:0;background:var(--paper);padding-bottom:2px}.review-row{display:grid;gap:5px}.review-row strong{text-align:left}}
  </style>
</head>
<body>
  <main class="shell">
    <section class="story" aria-labelledby="page-title">
      <div class="brand"><span class="brand-mark" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2 4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3Z" fill="#fff"/><path d="m8.2 12.1 2.3 2.3 5.2-5.1" stroke="#087466" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Kourify</div>
      <h1 id="page-title">Protection that follows through.</h1>
      <p>When delivery does not go as planned, tell us what happened. A real person will review your claim and follow up by email.</p>
      <div class="promise">
        <div class="promise-item"><span class="promise-icon">✓</span><span><strong>Secure verification</strong><br>We match your details to the store order.</span></div>
        <div class="promise-item"><span class="promise-icon">✓</span><span><strong>Human review</strong><br>Every claim is considered individually.</span></div>
        <div class="promise-item"><span class="promise-icon">✓</span><span><strong>Clear communication</strong><br>Updates are sent to your order email.</span></div>
      </div>
    </section>

    <section class="panel" aria-labelledby="claim-title">
      <p class="eyebrow">Shopping guarantee</p>
      <h2 id="claim-title">File a claim</h2>
      <p class="intro">Most submissions take only a few minutes.</p>

      <div class="progress" aria-label="Claim progress">
        <div class="progress-item is-active" data-progress="0" data-short="Order">Order info</div>
        <div class="progress-item" data-progress="1" data-short="Contact">Contact</div>
        <div class="progress-item" data-progress="2" data-short="Issue">Issue details</div>
        <div class="progress-item" data-progress="3" data-short="Review">Review</div>
      </div>

      <div class="error" role="alert" data-error></div>
      <form data-claim-form novalidate>
        <div class="step is-active" data-step="0">
          <h3>Find your protected order</h3>
          <p class="step-copy">Use the details shown in your confirmation email.</p>
          <div class="grid">
            <div class="field"><label for="orderNumber">Order number</label><input id="orderNumber" name="orderNumber" placeholder="#1234" autocomplete="off" required></div>
            <div class="field"><label for="confirmationCode">Confirmation code</label><input id="confirmationCode" name="confirmationCode" placeholder="e.g. AB12CD34" autocomplete="off"></div>
          </div>
        </div>

        <div class="step" data-step="1">
          <h3>How can we reach you?</h3>
          <p class="step-copy">Use the email attached to your Shopify order.</p>
          <div class="grid">
            <div class="field"><label for="fullName">Full name</label><input id="fullName" name="fullName" autocomplete="name" required></div>
            <div class="field"><label for="email">Order email</label><input id="email" name="email" type="email" autocomplete="email" required></div>
          </div>
        </div>

        <div class="step" data-step="2">
          <h3>What happened?</h3>
          <p class="step-copy">Choose the closest match and share the useful details.</p>
          <div class="field"><label for="issueType">Issue</label><select id="issueType" name="issueType">${issueOptions}</select></div>
          <div class="field"><label for="details">Details</label><textarea id="details" name="details" placeholder="Tell us when you noticed the issue and what was affected."></textarea></div>
          <div class="field upload" data-evidence-wrap hidden><label for="evidence">Photo evidence</label><input id="evidence" name="evidence" type="file" accept="image/*"><span class="hint">Required for damaged or concealed-damage claims. Maximum 5 MB.</span></div>
        </div>

        <div class="step" data-step="3">
          <h3>Review your claim</h3>
          <p class="step-copy">Make sure these details are correct before submitting.</p>
          <div class="review" data-review></div>
          <div class="notice">Submitting a claim does not guarantee approval or an automatic payout. Kourify reviews each claim under the merchant's configured protection terms.</div>
        </div>

        <div class="actions" data-actions>
          <button class="secondary" type="button" data-back hidden>Back</button>
          <button class="primary" type="button" data-next>Continue</button>
        </div>
      </form>
      <p class="legal">Your information is used only to verify and review this protection claim.</p>
    </section>
  </main>

  <script>
    (function(){
      var step=0;var maxBytes=5*1024*1024;var evidenceImage="";var requiredEvidence=["damaged","concealed"];
      var form=document.querySelector("[data-claim-form]");var next=document.querySelector("[data-next]");var back=document.querySelector("[data-back]");var error=document.querySelector("[data-error]");var wrap=document.querySelector("[data-evidence-wrap]");var evidence=document.querySelector("#evidence");var issue=document.querySelector("#issueType");
      function showError(message){error.textContent=message;error.classList.add("is-visible");error.scrollIntoView({behavior:"smooth",block:"center"})}
      function clearError(){error.textContent="";error.classList.remove("is-visible")}
      function values(){var data=new FormData(form);return{orderNumber:String(data.get("orderNumber")||"").trim(),confirmationCode:String(data.get("confirmationCode")||"").trim(),fullName:String(data.get("fullName")||"").trim(),email:String(data.get("email")||"").trim(),issueType:String(data.get("issueType")||""),details:String(data.get("details")||"").trim(),evidenceImage:evidenceImage}}
      function syncEvidence(){wrap.hidden=requiredEvidence.indexOf(issue.value)===-1}issue.addEventListener("change",syncEvidence);syncEvidence();
      evidence.addEventListener("change",function(){var file=evidence.files&&evidence.files[0];evidenceImage="";if(!file)return;if(file.size>maxBytes){evidence.value="";showError("Please choose an image smaller than 5 MB.");return}var reader=new FileReader();reader.onload=function(){evidenceImage=String(reader.result||"");clearError()};reader.readAsDataURL(file)});
      function validate(){var data=values();if(step===0&&!data.orderNumber){showError("Enter your order number to continue.");return false}if(step===1&&(!data.fullName||!data.email)){showError("Enter your full name and order email to continue.");return false}if(step===1&&!/^\\S+@\\S+\\.\\S+$/.test(data.email)){showError("Enter a valid email address.");return false}if(step===2&&requiredEvidence.indexOf(data.issueType)!==-1&&!data.evidenceImage){showError("Attach a photo for this type of claim.");return false}clearError();return true}
      function renderReview(){var data=values();var label=issue.options[issue.selectedIndex]?issue.options[issue.selectedIndex].text:data.issueType;document.querySelector("[data-review]").innerHTML='<div class="review-row"><span>Order</span><strong>'+safe(data.orderNumber)+'</strong></div><div class="review-row"><span>Contact</span><strong>'+safe(data.fullName)+'<br>'+safe(data.email)+'</strong></div><div class="review-row"><span>Issue</span><strong>'+safe(label)+'</strong></div>'}
      function safe(value){var node=document.createElement("div");node.textContent=value;return node.innerHTML}
      function render(){document.querySelectorAll("[data-step]").forEach(function(el){el.classList.toggle("is-active",Number(el.getAttribute("data-step"))===step)});document.querySelectorAll("[data-progress]").forEach(function(el){var i=Number(el.getAttribute("data-progress"));el.classList.toggle("is-active",i===step);el.classList.toggle("is-done",i<step)});back.hidden=step===0;next.textContent=step===3?"Submit claim":"Continue";if(step===3)renderReview();clearError()}
      function submit(){var data=values();next.disabled=true;next.textContent="Submitting…";fetch("/apps/kourify/claim",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}).then(function(response){return response.json().catch(function(){return{}}).then(function(json){return{ok:response.ok,json:json}})}).then(function(result){if(!result.ok)throw new Error(result.json.error||"We could not submit your claim.");form.innerHTML='<div class="success"><div class="success-mark">✓</div><h3>Claim received</h3><p>Thank you. Our team will review your claim and follow up at <strong>'+safe(data.email)+'</strong>.</p></div>';document.querySelector(".progress").hidden=true;document.querySelector(".legal").hidden=true}).catch(function(reason){next.disabled=false;next.textContent="Submit claim";showError(reason.message||"Something went wrong. Please try again.")})}
      next.addEventListener("click",function(){if(!validate())return;if(step===3){submit();return}step+=1;render()});back.addEventListener("click",function(){if(step>0){step-=1;render()}});
    })();
  </script>
</body>
</html>`;

  const localizedPage =
    locale === "fr"
      ? Object.entries(FRENCH_COPY).reduce(
          (html, [english, translated]) => html.replaceAll(english, translated),
          page,
        )
      : page;
  return liquid(localizedPage, { layout: false });
};
