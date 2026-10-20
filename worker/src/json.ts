// JSON.parse rounds integers past 2^53, and some platforms send ids that big as bare
// numbers (TikTok's 19-digit post ids), which turns them into another post's id. This
// parses with every such integer kept as its exact digits, as a string.
const BIG = 16; // digits; anything this long may be past 2^53

export function parseJson(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      // Copy the whole string untouched.
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < text.length && /[0-9.eE+-]/.test(text[j])) j++;
      const number = text.slice(i, j);
      out += /^-?\d+$/.test(number) && number.replace("-", "").length >= BIG ? `"${number}"` : number;
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out);
}
