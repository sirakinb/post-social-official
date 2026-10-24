// Crisp support chat: the snippet the root layout puts in the page's <head>, as Crisp asks, and
// the pages it stays off. Shared by the layout (server) and SupportChatVisibility (browser).
export const CRISP_WEBSITE_ID = "f6e9161e-ebd2-452c-98fd-2b9a059fd0e9";

const HIDDEN = /^\/(oauth|tiktok-media)(\/|$)/;

export function chatHiddenOn(pathname: string) {
  return HIDDEN.test(pathname);
}

// Crisp's snippet, plus: start hidden on the pages above, and never add the loader twice.
export const CRISP_SNIPPET = `window.$crisp=window.$crisp||[];window.CRISP_WEBSITE_ID="${CRISP_WEBSITE_ID}";if(${HIDDEN}.test(location.pathname))window.$crisp.push(["do","chat:hide"]);(function(){if(document.getElementById("crisp-loader"))return;var d=document,s=d.createElement("script");s.id="crisp-loader";s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`;
