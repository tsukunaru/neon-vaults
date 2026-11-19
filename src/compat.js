export function objectEntries(value) {
  return Object.keys(value).map((key) => [key, value[key]]);
}

export function objectValues(value) {
  return Object.keys(value).map((key) => value[key]);
}

export function fromEntries(pairs) {
  const result = {};
  for (const [key, value] of pairs) {
    Object.defineProperty(result, key, { configurable: true, enumerable: true, value, writable: true });
  }
  return result;
}

export function setChildren(element, children) {
  element.textContent = "";
  children.forEach((child) => element.appendChild(child));
}

export function pad2(value) {
  const text = String(value);
  return text.length < 2 ? `0${text}` : text;
}
