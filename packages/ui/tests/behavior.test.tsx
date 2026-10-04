// @vitest-environment jsdom
// Поведение Dialog и AssistantPanel в DOM. Один и тот же сценарий прогоняется и на классическом
// bundle.js (исполненном в node:vm поверх document из jsdom), и на @console/ui — поведение обязано совпадать.
// Сценарии идут на русском: без LocaleProvider компоненты берут язык документа (lang="ru").
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import * as React from "react";
import { useState, type ComponentType } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as UI from "../src/index";
import type { AssistantPanelProps, ComboboxProps, DialogProps } from "../src/index";

const BUNDLE = resolve(import.meta.dirname, "../../../design-system/components/bundle.js");

function loadBundle(): Record<string, unknown> {
  const sandbox: { window: { React: typeof React; TaimenConsole?: Record<string, unknown> }; document: Document } = { window: { React }, document };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(BUNDLE, "utf8"), sandbox, { filename: "bundle.js" });
  if (!sandbox.window.TaimenConsole) throw new Error("bundle.js не положил window.TaimenConsole");
  return sandbox.window.TaimenConsole;
}

const OLD = loadBundle();

interface Impl {
  Dialog: ComponentType<DialogProps>;
  AssistantPanel: ComponentType<AssistantPanelProps>;
  LocaleProvider: ComponentType<UI.LocaleProviderProps>;
  Combobox: ComponentType<ComboboxProps>;
}
const IMPLS: [string, Impl][] = [
  ["bundle.js", { Dialog: OLD["Dialog"] as Impl["Dialog"], AssistantPanel: OLD["AssistantPanel"] as Impl["AssistantPanel"], LocaleProvider: OLD["LocaleProvider"] as Impl["LocaleProvider"], Combobox: OLD["Combobox"] as Impl["Combobox"] }],
  ["@console/ui", { Dialog: UI.Dialog, AssistantPanel: UI.AssistantPanel, LocaleProvider: UI.LocaleProvider, Combobox: UI.Combobox }],
];

beforeEach(() => { document.documentElement.lang = "ru"; });
afterEach(() => { cleanup(); document.documentElement.lang = ""; });

describe.each(IMPLS)("Dialog (%s)", (_name, impl) => {
  const Dialog = impl.Dialog;

  function Harness(props: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => { setOpen(true); }}>Открыть</button>
        {open ? (
          <Dialog title="Снять работу" hint="Необратимо" onClose={() => { props.onClose(); setOpen(false); }}
            footer={<><button type="button">Отмена</button><button type="button">Снять</button></>}>
            <input aria-label="Причина" />
          </Dialog>
        ) : null}
      </>
    );
  }

  function open(onClose = vi.fn()) {
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Открыть" });
    opener.focus();
    fireEvent.click(opener);
    return { opener, onClose };
  }

  it("фокус уходит на первое поле, заголовок связан с окном", () => {
    open();
    expect(document.activeElement).toBe(screen.getByLabelText("Причина"));
    const dlg = screen.getByRole("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dlg.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Снять работу");
  });

  it("Esc закрывает, фокус возвращается на открывшую кнопку", () => {
    const { opener, onClose } = open();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("Tab и Shift+Tab не выпускают фокус из окна", () => {
    open();
    const close = screen.getByRole("button", { name: "Закрыть" });
    const last = screen.getByRole("button", { name: "Снять" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("клик по подложке закрывает, клик внутри — нет", () => {
    const { onClose } = open();
    fireEvent.mouseDown(screen.getByLabelText("Причина"));
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = document.querySelector(".tc-backdrop");
    if (!backdrop) throw new Error("нет подложки");
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("кнопка «Закрыть» закрывает", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe.each(IMPLS)("AssistantPanel docked (%s)", (_name, impl) => {
  const Panel = impl.AssistantPanel;

  function setup(value: string) {
    const onSend = vi.fn();
    const onChange = vi.fn();
    render(<Panel docked={true} value={value} onChange={onChange} onSend={onSend} onClose={vi.fn()} />);
    return { onSend, onChange, input: screen.getByLabelText("Сообщение ассистенту") };
  }

  it("Enter отправляет и не вставляет перенос строки", () => {
    const { onSend, input } = setup("Почему стоит?");
    const notPrevented = fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it("Shift+Enter — перенос строки, без отправки", () => {
    const { onSend, input } = setup("Почему стоит?");
    const notPrevented = fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it("Enter во время набора IME не отправляет", () => {
    const { onSend, input } = setup("Почему");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("кнопка «Отправить» выключена на пустом поле и отправляет на непустом", () => {
    setup("   ");
    expect(screen.getByRole("button", { name: "Отправить" })).toHaveProperty("disabled", true);
    cleanup();
    const { onSend } = setup("Кто решает?");
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("подсказка пустой беседы уходит в onSuggest, «Закрыть» — в onClose", () => {
    const onSuggest = vi.fn(), onClose = vi.fn();
    render(<Panel docked={true} suggestions={["Что ждёт меня?"]} onSuggest={onSuggest} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Что ждёт меня?" }));
    expect(onSuggest).toHaveBeenCalledWith("Что ждёт меня?");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть ассистента" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe.each(IMPLS)("язык документа и LocaleProvider (%s)", (_name, impl) => {
  const Panel = impl.AssistantPanel, Provider = impl.LocaleProvider;

  it("lang=\"ru\" — русские подписи", () => {
    render(<Panel docked={true} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Сообщение ассистенту")).toBeTruthy();
  });

  it("lang=\"en-US\" — английские подписи", () => {
    document.documentElement.lang = "en-US";
    render(<Panel docked={true} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Message to the assistant")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close assistant" })).toBeTruthy();
  });

  it("без lang и без провайдера — en", () => {
    document.documentElement.lang = "";
    render(<Panel docked={true} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("LocaleProvider главнее языка документа", () => {
    render(<Provider locale="en"><Panel docked={true} onClose={vi.fn()} /></Provider>);
    expect(screen.getByLabelText("Message to the assistant")).toBeTruthy();
    cleanup();
    document.documentElement.lang = "en";
    render(<Provider locale="ru"><Panel docked={true} onClose={vi.fn()} /></Provider>);
    expect(screen.getByLabelText("Сообщение ассистенту")).toBeTruthy();
  });
});

describe.each(IMPLS)("Combobox (%s)", (_name, impl) => {
  const { Combobox, Dialog } = impl;
  const options = [
    { value: "u1", label: "Ирина Котова", meta: "Финансовый директор" },
    { value: "u2", label: "Иван Лебедев", meta: "Бухгалтер" },
    { value: "a1", label: "Сверщик счетов", search: "агент reconciler" },
    { value: "u3", label: "Пётр Сидоров", disabled: true },
  ];
  function Harness(props: { onChange: (v: string | null) => void, inDialog?: { onClose: () => void } }) {
    const [value, setValue] = useState<string | null>("u1");
    const box = <Combobox label="Исполняет" options={options} value={value} clearLabel="не назначено" onChange={(v) => { setValue(v); props.onChange(v); }} />;
    return props.inDialog ? <Dialog title="Передать" onClose={props.inDialog.onClose}>{box}</Dialog> : box;
  }

  it("закрыт — выбранное в поле; фокус открывает список", () => {
    render(<Harness onChange={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Исполняет" }) as HTMLInputElement;
    expect(input.value).toBe("Ирина Котова");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.focus(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual(["не назначено", "Ирина КотоваФинансовый директор", "Иван ЛебедевБухгалтер", "Сверщик счетов", "Пётр Сидоров"]);
  });

  it("ввод сужает по названию, meta и search, без учёта регистра и «ё»; Enter выбирает", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "БУХГАЛ" } });
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual(["Иван ЛебедевБухгалтер"]);
    fireEvent.change(input, { target: { value: "reconc" } });
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual(["Сверщик счетов"]);
    fireEvent.change(input, { target: { value: "петр" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.change(input, { target: { value: "иван" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("u2");
    expect(input.value).toBe("Иван Лебедев");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("↓ и Enter; выключенный вариант не выбирается; очистка — null", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "пётр" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "зззз" } });
    expect(screen.getByRole("option").textContent).toBe("Ничего не найдено");
  });

  it("Esc закрывает список, а не диалог вокруг; второй Esc — диалог", () => {
    const onClose = vi.fn();
    render(<Harness onChange={vi.fn()} inDialog={{ onClose }} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
