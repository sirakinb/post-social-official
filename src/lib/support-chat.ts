// Crisp support chat: the snippet the root layout puts in the page's <head>, as Crisp asks, and
// the pages it stays off. Shared by the layout (server) and SupportChatVisibility (browser).
export const CRISP_WEBSITE_ID = "f6e9161e-ebd2-452c-98fd-2b9a059fd0e9";

const HIDDEN = /^\/(oauth|tiktok-media)(\/|$)/;

export function chatHiddenOn(pathname: string) {
  return HIDDEN.test(pathname);
}

// On a phone the chat bubble would sit on the composer's Post button, so it stays off there.
const HIDDEN_ON_PHONES = /^\/beta\/create(\/|$)/;

export function chatHiddenOnPhone(pathname: string) {
  return HIDDEN_ON_PHONES.test(pathname);
}

// Crisp only offers named colours; deep purple is the closest to Post Social's violet, on the
// dark look the site uses.
export const CRISP_THEME = { color: "deep_purple", mode: "dark" } as const;

// Crisp's snippet, plus: Post Social's colours, start hidden on the pages above, and never add
// the loader twice.
export const CRISP_SNIPPET = `window.$crisp=window.$crisp||[];window.CRISP_WEBSITE_ID="${CRISP_WEBSITE_ID}";window.$crisp.push(["config","color:theme",["${CRISP_THEME.color}"]]);window.$crisp.push(["config","color:mode",["${CRISP_THEME.mode}"]]);if(${HIDDEN}.test(location.pathname))window.$crisp.push(["do","chat:hide"]);(function(){if(document.getElementById("crisp-loader"))return;var d=document,s=d.createElement("script");s.id="crisp-loader";s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`;
