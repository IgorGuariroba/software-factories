/** DOM mínimo para exercitar os handlers reais da página, sem dependência de navegador. */
export class PageElement {
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, ((event: PageEvent) => unknown)[]>();
  children: (PageElement | string)[] = [];
  parentElement: PageElement | null = null;
  value = "";
  disabled = false;
  hidden = false;
  className = "";
  isConnected = true;
  private text = "";
  constructor(readonly tagName: string) {}
  get textContent(): string {
    return this.text + this.children.map((child) => (typeof child === "string" ? child : child.textContent)).join("");
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  addEventListener(name: string, listener: (event: PageEvent) => unknown): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  append(...children: (PageElement | string)[]): void {
    for (const child of children) {
      if (typeof child !== "string") child.parentElement = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children: (PageElement | string)[]): void {
    this.text = "";
    this.children = [];
    this.append(...children);
  }
  all(): PageElement[] {
    return [this, ...this.children.flatMap((child) => (typeof child === "string" ? [] : child.all()))];
  }
  querySelector(selector: string): PageElement | null {
    const found = this.all()
      .slice(1)
      .find((element) => element.tagName.toLowerCase() === selector);
    if (found) return found;
    if (selector !== "tbody") return null;
    const tbody = new PageElement("TBODY");
    this.append(tbody);
    return tbody;
  }
  async fire(name: string): Promise<void> {
    for (const listener of this.listeners.get(name) ?? []) {
      await listener({ target: this, currentTarget: this, preventDefault() {} });
    }
  }
}
interface PageEvent {
  target: PageElement;
  currentTarget: PageElement;
  preventDefault(): void;
}
export class PageDocument {
  private readonly ids = new Map<string, PageElement>();
  createElement(tag: string): PageElement {
    return new PageElement(tag.toUpperCase());
  }
  getElementById(id: string): PageElement {
    let element = this.ids.get(id);
    if (!element) {
      element = new PageElement("DIV");
      element.setAttribute("id", id);
      this.ids.set(id, element);
    }
    return element;
  }
}
