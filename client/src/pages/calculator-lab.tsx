import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Calculator,
  ChevronDown,
  Clock,
  Copy,
  CornerDownLeft,
  History,
  Percent,
  RefreshCcw,
  Ruler,
  Sigma,
  SunMoon,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";

type Mode = "standard" | "scientific" | "unit" | "date" | "finance" | "health";

type HistoryItem = {
  id: string;
  at: number;
  expr: string;
  result: string;
  mode: Mode;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatNumber(n: number) {
  if (!Number.isFinite(n)) return "Error";
  if (Object.is(n, -0)) n = 0;

  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-6)) {
    return n
      .toExponential(12)
      .replace(/\.0+e/, "e")
      .replace(/e\+?/, "e");
  }

  return n.toLocaleString(undefined, {
    maximumFractionDigits: 12,
  });
}

function tryParseNumberLike(s: string) {
  const cleaned = s.replace(/,/g, "").trim();
  if (!cleaned) return NaN;
  return Number(cleaned);
}

function clampHistory(items: HistoryItem[]) {
  return items.slice(0, 50);
}

function safeEvalExpression(expr: string) {
  // Supports: + - * / ^, parentheses, unary minus, decimals
  // Also supports % as a postfix percent (x% => x/100)
  // And constants: pi, e

  const raw = expr
    .replace(/\u00d7/g, "*")
    .replace(/\u00f7/g, "/")
    .replace(/\u03c0/gi, "pi")
    .replace(/\s+/g, "")
    .toLowerCase();

  if (!raw) return { ok: false as const, error: "Empty" };
  if (/[^0-9+\-*/^().%a-z]/.test(raw)) {
    return { ok: false as const, error: "Invalid characters" };
  }

  type Token =
    | { t: "num"; v: number }
    | { t: "op"; v: "+" | "-" | "*" | "/" | "^" }
    | { t: "lpar" }
    | { t: "rpar" }
    | { t: "id"; v: "pi" | "e" }
    | { t: "pct" };

  const tokens: Token[] = [];
  let i = 0;

  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isAlpha = (c: string) =>
    (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

  while (i < raw.length) {
    const c = raw[i]!;

    if (c === "(") {
      tokens.push({ t: "lpar" });
      i++;
      continue;
    }

    if (c === ")") {
      tokens.push({ t: "rpar" });
      i++;
      continue;
    }

    if (c === "%") {
      tokens.push({ t: "pct" });
      i++;
      continue;
    }

    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "^") {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }

    if (isDigit(c) || c === ".") {
      let j = i + 1;
      while (j < raw.length && (isDigit(raw[j]!) || raw[j] === ".")) j++;
      const numStr = raw.slice(i, j);
      const v = Number(numStr);
      if (!Number.isFinite(v)) return { ok: false as const, error: "Bad number" };
      tokens.push({ t: "num", v });
      i = j;
      continue;
    }

    if (isAlpha(c)) {
      let j = i + 1;
      while (j < raw.length && isAlpha(raw[j]!)) j++;
      const ident = raw.slice(i, j) as string;
      if (ident === "pi" || ident === "e") {
        tokens.push({ t: "id", v: ident });
        i = j;
        continue;
      }
      return { ok: false as const, error: `Unknown identifier: ${ident}` };
    }

    return { ok: false as const, error: "Parse error" };
  }

  // Shunting-yard to RPN
  const output: Token[] = [];
  const ops: Token[] = [];

  const prec: Record<string, number> = {
    "+": 1,
    "-": 1,
    "*": 2,
    "/": 2,
    "^": 3,
  };
  const rightAssoc: Record<string, boolean> = { "^": true };

  // Handle unary minus by rewriting: ( -x ) => (0 - x)
  const normalized: Token[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k]!;
    if (tk.t === "op" && tk.v === "-") {
      const prev = normalized[normalized.length - 1];
      const unary = !prev || prev.t === "op" || prev.t === "lpar";
      if (unary) {
        normalized.push({ t: "num", v: 0 });
        normalized.push({ t: "op", v: "-" });
        continue;
      }
    }
    normalized.push(tk);
  }

  for (let k = 0; k < normalized.length; k++) {
    const tk = normalized[k]!;

    if (tk.t === "num" || tk.t === "id") {
      output.push(tk);
      continue;
    }

    if (tk.t === "pct") {
      // postfix percent binds tightest to previous value
      output.push(tk);
      continue;
    }

    if (tk.t === "op") {
      while (ops.length) {
        const top = ops[ops.length - 1]!;
        if (top.t !== "op") break;
        const pTop = prec[top.v];
        const pCur = prec[tk.v];
        if (pTop > pCur || (pTop === pCur && !rightAssoc[tk.v])) {
          output.push(ops.pop()!);
        } else {
          break;
        }
      }
      ops.push(tk);
      continue;
    }

    if (tk.t === "lpar") {
      ops.push(tk);
      continue;
    }

    if (tk.t === "rpar") {
      let found = false;
      while (ops.length) {
        const top = ops.pop()!;
        if (top.t === "lpar") {
          found = true;
          break;
        }
        output.push(top);
      }
      if (!found)
        return { ok: false as const, error: "Mismatched parentheses" };
      continue;
    }
  }

  while (ops.length) {
    const top = ops.pop()!;
    if (top.t === "lpar" || top.t === "rpar")
      return { ok: false as const, error: "Mismatched parentheses" };
    output.push(top);
  }

  // Evaluate RPN
  const stack: number[] = [];

  for (const tk of output) {
    if (tk.t === "num") {
      stack.push(tk.v);
      continue;
    }

    if (tk.t === "id") {
      stack.push(tk.v === "pi" ? Math.PI : Math.E);
      continue;
    }

    if (tk.t === "pct") {
      if (stack.length < 1)
        return { ok: false as const, error: "Percent missing value" };
      const a = stack.pop()!;
      stack.push(a / 100);
      continue;
    }

    if (tk.t === "op") {
      if (stack.length < 2)
        return { ok: false as const, error: "Operator missing values" };
      const b = stack.pop()!;
      const a = stack.pop()!;
      let r = 0;
      switch (tk.v) {
        case "+":
          r = a + b;
          break;
        case "-":
          r = a - b;
          break;
        case "*":
          r = a * b;
          break;
        case "/":
          r = a / b;
          break;
        case "^":
          r = Math.pow(a, b);
          break;
      }
      stack.push(r);
      continue;
    }
  }

  if (stack.length !== 1) return { ok: false as const, error: "Bad expression" };
  const value = stack[0]!;

  if (!Number.isFinite(value)) return { ok: false as const, error: "Math error" };
  return { ok: true as const, value };
}

function useThemeToggle() {
  const [isDark, setIsDark] = useState<boolean>(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  return { isDark, setIsDark };
}

function Key({
  label,
  onClick,
  variant,
  testId,
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "primary" | "danger";
  testId: string;
}) {
  const cn =
    variant === "primary"
      ? "btn-key btn-key-primary"
      : variant === "danger"
        ? "btn-key btn-key-danger"
        : "btn-key";

  return (
    <button
      type="button"
      className={cn}
      onClick={onClick}
      data-testid={testId}
    >
      {label}
    </button>
  );
}

function StandardCalc({
  onCommitHistory,
}: {
  onCommitHistory: (item: Omit<HistoryItem, "id" | "at">) => void;
}) {
  const [expr, setExpr] = useState<string>("");
  const [result, setResult] = useState<string>("0");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const evaluate = (e: string) => {
    const out = safeEvalExpression(e);
    if (!out.ok) {
      setResult("Error");
      return;
    }
    setResult(formatNumber(out.value));
  };

  const commit = () => {
    const out = safeEvalExpression(expr);
    if (!out.ok) {
      toast({ title: "Can’t calculate", description: out.error });
      return;
    }
    const r = formatNumber(out.value);
    setResult(r);
    onCommitHistory({ expr, result: r, mode: "standard" });
    setExpr(r.replace(/,/g, ""));
  };

  const append = (s: string) => {
    const next = `${expr}${s}`;
    setExpr(next);
    evaluate(next);
  };

  const backspace = () => {
    const next = expr.slice(0, -1);
    setExpr(next);
    if (!next) {
      setResult("0");
    } else {
      evaluate(next);
    }
  };

  const clear = () => {
    setExpr("");
    setResult("0");
    inputRef.current?.focus();
  };

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const k = ev.key;
      if (k === "Enter") {
        ev.preventDefault();
        commit();
        return;
      }
      if (k === "Backspace") {
        ev.preventDefault();
        backspace();
        return;
      }
      if (k === "Escape") {
        ev.preventDefault();
        clear();
        return;
      }

      const allowed = "0123456789.+-*/()^%";
      if (allowed.includes(k)) {
        ev.preventDefault();
        append(k);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="grid gap-4">
      <div className="glass rounded-2xl p-4 display-sheen">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">Expression</div>
            <Input
              ref={inputRef}
              value={expr}
              onChange={(e) => {
                setExpr(e.target.value);
                if (e.target.value) evaluate(e.target.value);
                else setResult("0");
              }}
              placeholder="Type: (2+3)*4^2 or 10%"
              className="mt-2 font-mono"
              data-testid="input-expression"
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              navigator.clipboard
                .writeText(result)
                .then(() =>
                  toast({
                    title: "Copied",
                    description: "Result copied to clipboard.",
                  }),
                )
                .catch(() =>
                  toast({
                    title: "Copy failed",
                    description: "Couldn’t access clipboard.",
                  }),
                );
            }}
            data-testid="button-copy-result"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="text-xs text-muted-foreground">Result</div>
          <div
            className="text-right font-display text-3xl tracking-tight"
            data-testid="text-result"
          >
            {result}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <CornerDownLeft className="h-3.5 w-3.5" />
          Press Enter to commit to history
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Key
          label="AC"
          variant="danger"
          onClick={clear}
          testId="button-clear"
        />
        <Key
          label="( )"
          onClick={() => append(expr.endsWith("(") ? ")" : "(")}
          testId="button-parens"
        />
        <Key label="%" onClick={() => append("%")}
          testId="button-percent"
        />
        <Key label="÷" onClick={() => append("/")} testId="button-divide" />

        <Key label="7" onClick={() => append("7")} testId="button-7" />
        <Key label="8" onClick={() => append("8")} testId="button-8" />
        <Key label="9" onClick={() => append("9")} testId="button-9" />
        <Key
          label="×"
          onClick={() => append("*")}
          testId="button-multiply"
        />

        <Key label="4" onClick={() => append("4")} testId="button-4" />
        <Key label="5" onClick={() => append("5")} testId="button-5" />
        <Key label="6" onClick={() => append("6")} testId="button-6" />
        <Key label="−" onClick={() => append("-")} testId="button-minus" />

        <Key label="1" onClick={() => append("1")} testId="button-1" />
        <Key label="2" onClick={() => append("2")} testId="button-2" />
        <Key label="3" onClick={() => append("3")} testId="button-3" />
        <Key label="+" onClick={() => append("+")} testId="button-plus" />

        <Key label="0" onClick={() => append("0")} testId="button-0" />
        <Key label="." onClick={() => append(".")} testId="button-dot" />
        <button
          type="button"
          className="btn-key col-span-1"
          onClick={backspace}
          data-testid="button-backspace"
        >
          ⌫
        </button>
        <Key
          label="="
          variant="primary"
          onClick={commit}
          testId="button-equals"
        />
      </div>
    </div>
  );
}

function ScientificCalc({
  onCommitHistory,
}: {
  onCommitHistory: (item: Omit<HistoryItem, "id" | "at">) => void;
}) {
  const [expr, setExpr] = useState<string>("");
  const [result, setResult] = useState<string>("0");

  const evalExpr = (e: string) => {
    const out = safeEvalExpression(e);
    if (!out.ok) {
      setResult("Error");
      return;
    }
    setResult(formatNumber(out.value));
  };

  const commit = () => {
    const out = safeEvalExpression(expr);
    if (!out.ok) {
      toast({ title: "Can’t calculate", description: out.error });
      return;
    }
    const r = formatNumber(out.value);
    setResult(r);
    onCommitHistory({ expr, result: r, mode: "scientific" });
    setExpr(r.replace(/,/g, ""));
  };

  const insertFn = (
    fn: "sin" | "cos" | "tan" | "ln" | "log" | "sqrt",
  ) => {
    const current = expr ? expr : result.replace(/,/g, "");
    const x = safeEvalExpression(current);
    if (!x.ok) {
      toast({
        title: "Invalid input",
        description: "Please enter a valid expression first.",
      });
      return;
    }

    let r = x.value;
    switch (fn) {
      case "sin":
        r = Math.sin(x.value);
        break;
      case "cos":
        r = Math.cos(x.value);
        break;
      case "tan":
        r = Math.tan(x.value);
        break;
      case "ln":
        r = Math.log(x.value);
        break;
      case "log":
        r = Math.log10(x.value);
        break;
      case "sqrt":
        r = Math.sqrt(x.value);
        break;
    }

    const formatted = formatNumber(r);
    setResult(formatted);
    setExpr(formatted.replace(/,/g, ""));
    onCommitHistory({
      expr: `${fn}(${current})`,
      result: formatted,
      mode: "scientific",
    });
  };

  const append = (s: string) => {
    const next = `${expr}${s}`;
    setExpr(next);
    evalExpr(next);
  };

  const clear = () => {
    setExpr("");
    setResult("0");
  };

  return (
    <div className="grid gap-4">
      <div className="glass rounded-2xl p-4 display-sheen">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">Expression</div>
            <Input
              value={expr}
              onChange={(e) => {
                setExpr(e.target.value);
                if (e.target.value) evalExpr(e.target.value);
                else setResult("0");
              }}
              placeholder="Try: pi^2/6, (1+2)^3, 1/3"
              className="mt-2 font-mono"
              data-testid="input-scientific-expression"
            />
          </div>
          <Button
            variant="secondary"
            onClick={clear}
            data-testid="button-scientific-clear"
          >
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="text-xs text-muted-foreground">Result</div>
          <div
            className="text-right font-display text-3xl tracking-tight"
            data-testid="text-scientific-result"
          >
            {result}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className="btn-key"
          onClick={() => append("(")}
          data-testid="button-sci-lpar"
        >
          (
        </button>
        <button
          type="button"
          className="btn-key"
          onClick={() => append(")")}
          data-testid="button-sci-rpar"
        >
          )
        </button>
        <button
          type="button"
          className="btn-key"
          onClick={() => append("^")}
          data-testid="button-sci-pow"
        >
          x^y
        </button>

        <button
          type="button"
          className="btn-key"
          onClick={() => append("pi")}
          data-testid="button-sci-pi"
        >
          π
        </button>
        <button
          type="button"
          className="btn-key"
          onClick={() => append("e")}
          data-testid="button-sci-e"
        >
          e
        </button>
        <button
          type="button"
          className="btn-key"
          onClick={() => append("%")}
          data-testid="button-sci-percent"
        >
          <Percent className="mx-auto h-4 w-4" />
        </button>

        <button
          type="button"
          className="btn-key"
          onClick={() => insertFn("sqrt")}
          data-testid="button-sci-sqrt"
        >
          √
        </button>
        <button
          type="button"
          className="btn-key"
          onClick={() => insertFn("ln")}
          data-testid="button-sci-ln"
        >
          ln
        </button>
        <button
          type="button"
          className="btn-key"
          onClick={() => insertFn("log")}
          data-testid="button-sci-log"
        >
          log
        </button>

        <button
          type="button"
          className="btn-key"
          onClick={() => insertFn("sin")}
          data-testid="button-sci-sin"
        >
          sin
        </button>
        <button
          type="button"
          className="btn-key"
          onClick={() => insertFn("cos")}
          data-testid="button-sci-cos"
        >
          cos
        </button>
        <button
          type="button"
          className="btn-key"
          onClick={() => insertFn("tan")}
          data-testid="button-sci-tan"
        >
          tan
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Key label="7" onClick={() => append("7")} testId="button-sci-7" />
        <Key label="8" onClick={() => append("8")} testId="button-sci-8" />
        <Key label="9" onClick={() => append("9")} testId="button-sci-9" />
        <Key label="÷" onClick={() => append("/")} testId="button-sci-div" />

        <Key label="4" onClick={() => append("4")} testId="button-sci-4" />
        <Key label="5" onClick={() => append("5")} testId="button-sci-5" />
        <Key label="6" onClick={() => append("6")} testId="button-sci-6" />
        <Key label="×" onClick={() => append("*")} testId="button-sci-mul" />

        <Key label="1" onClick={() => append("1")} testId="button-sci-1" />
        <Key label="2" onClick={() => append("2")} testId="button-sci-2" />
        <Key label="3" onClick={() => append("3")} testId="button-sci-3" />
        <Key label="−" onClick={() => append("-")} testId="button-sci-sub" />

        <Key label="0" onClick={() => append("0")} testId="button-sci-0" />
        <Key label="." onClick={() => append(".")} testId="button-sci-dot" />
        <Key label="+" onClick={() => append("+")} testId="button-sci-add" />
        <Key
          label="="
          variant="primary"
          onClick={commit}
          testId="button-sci-eq"
        />
      </div>

      <div className="text-xs text-muted-foreground" data-testid="text-scientific-note">
        Notes: trig uses radians. Use π and e constants.
      </div>
    </div>
  );
}

type Unit = {
  key: string;
  label: string;
  toBase: (x: number) => number;
  fromBase: (x: number) => number;
};

type UnitCategoryDef = { label: string; units: Unit[] };

const unitDefs: Record<string, UnitCategoryDef> = {
  length: {
    label: "Length",
    units: [
      {
        key: "m",
        label: "Meters (m)",
        toBase: (x) => x,
        fromBase: (x) => x,
      },
      {
        key: "km",
        label: "Kilometers (km)",
        toBase: (x) => x * 1000,
        fromBase: (x) => x / 1000,
      },
      {
        key: "cm",
        label: "Centimeters (cm)",
        toBase: (x) => x / 100,
        fromBase: (x) => x * 100,
      },
      {
        key: "mm",
        label: "Millimeters (mm)",
        toBase: (x) => x / 1000,
        fromBase: (x) => x * 1000,
      },
      {
        key: "in",
        label: "Inches (in)",
        toBase: (x) => x * 0.0254,
        fromBase: (x) => x / 0.0254,
      },
      {
        key: "ft",
        label: "Feet (ft)",
        toBase: (x) => x * 0.3048,
        fromBase: (x) => x / 0.3048,
      },
    ],
  },
  mass: {
    label: "Mass",
    units: [
      {
        key: "kg",
        label: "Kilograms (kg)",
        toBase: (x) => x,
        fromBase: (x) => x,
      },
      {
        key: "g",
        label: "Grams (g)",
        toBase: (x) => x / 1000,
        fromBase: (x) => x * 1000,
      },
      {
        key: "lb",
        label: "Pounds (lb)",
        toBase: (x) => x * 0.45359237,
        fromBase: (x) => x / 0.45359237,
      },
      {
        key: "oz",
        label: "Ounces (oz)",
        toBase: (x) => x * 0.028349523125,
        fromBase: (x) => x / 0.028349523125,
      },
    ],
  },
  temperature: {
    label: "Temperature",
    units: [
      {
        key: "c",
        label: "Celsius (°C)",
        toBase: (x) => x,
        fromBase: (x) => x,
      },
      {
        key: "f",
        label: "Fahrenheit (°F)",
        toBase: (x) => (x - 32) * (5 / 9),
        fromBase: (x) => x * (9 / 5) + 32,
      },
      {
        key: "k",
        label: "Kelvin (K)",
        toBase: (x) => x - 273.15,
        fromBase: (x) => x + 273.15,
      },
    ],
  },
};

function UnitConverter() {
  const categoryKeys = Object.keys(unitDefs);
  const [cat, setCat] = useState<string>(categoryKeys[0] ?? "length");
  const catDef = unitDefs[cat] ?? unitDefs.length;

  const [fromKey, setFromKey] = useState<string>(catDef.units[0]?.key ?? "m");
  const [toKey, setToKey] = useState<string>(catDef.units[1]?.key ?? "km");
  const [fromValue, setFromValue] = useState<string>("1");

  useEffect(() => {
    const next = unitDefs[cat];
    if (!next) return;
    setFromKey(next.units[0]?.key ?? "");
    setToKey(next.units[1]?.key ?? next.units[0]?.key ?? "");
    setFromValue("1");
  }, [cat]);

  const computed = useMemo(() => {
    const n = tryParseNumberLike(fromValue);
    if (!Number.isFinite(n)) return "—";

    const fromU = catDef.units.find((u) => u.key === fromKey);
    const toU = catDef.units.find((u) => u.key === toKey);
    if (!fromU || !toU) return "—";

    const base = fromU.toBase(n);
    const out = toU.fromBase(base);
    return formatNumber(out);
  }, [fromValue, catDef, fromKey, toKey]);

  const swap = () => {
    setFromKey(toKey);
    setToKey(fromKey);
  };

  return (
    <div className="grid gap-4">
      <div className="glass rounded-2xl p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div
              className="font-display text-xl tracking-tight"
              data-testid="text-unit-title"
            >
              Unit Converter
            </div>
            <div
              className="text-sm text-muted-foreground"
              data-testid="text-unit-subtitle"
            >
              Precise conversions for everyday work.
            </div>
          </div>

          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger
              className="w-full md:w-[220px]"
              data-testid="select-unit-category"
            >
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {categoryKeys.map((k) => (
                <SelectItem
                  key={k}
                  value={k}
                  data-testid={`option-unit-category-${k}`}
                >
                  {unitDefs[k]?.label ?? k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator className="my-4" />

        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-end">
          <div className="grid gap-2">
            <div className="text-xs text-muted-foreground">From</div>
            <Select value={fromKey} onValueChange={setFromKey}>
              <SelectTrigger
                className="w-full"
                data-testid="select-unit-from"
              >
                <SelectValue placeholder="From" />
              </SelectTrigger>
              <SelectContent>
                {catDef.units.map((u) => (
                  <SelectItem
                    key={u.key}
                    value={u.key}
                    data-testid={`option-unit-from-${u.key}`}
                  >
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={fromValue}
              onChange={(e) => setFromValue(e.target.value)}
              className="font-mono"
              placeholder="Enter a value"
              data-testid="input-unit-from-value"
            />
          </div>

          <div className="flex items-center justify-center">
            <Button
              variant="secondary"
              onClick={swap}
              data-testid="button-unit-swap"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid gap-2">
            <div className="text-xs text-muted-foreground">To</div>
            <Select value={toKey} onValueChange={setToKey}>
              <SelectTrigger className="w-full" data-testid="select-unit-to">
                <SelectValue placeholder="To" />
              </SelectTrigger>
              <SelectContent>
                {catDef.units.map((u) => (
                  <SelectItem
                    key={u.key}
                    value={u.key}
                    data-testid={`option-unit-to-${u.key}`}
                  >
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="glass rounded-xl px-4 py-3">
              <div className="text-xs text-muted-foreground">Result</div>
              <div
                className="mt-1 font-display text-2xl tracking-tight"
                data-testid="text-unit-result"
              >
                {computed}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="text-xs text-muted-foreground"
        data-testid="text-unit-footnote"
      >
        Tip: You can type commas, decimals, and negatives.
      </div>
    </div>
  );
}

function FinanceCalculator() {
  const [loanAmount, setLoanAmount] = useState<string>("250000");
  const [interestRate, setInterestRate] = useState<string>("5.5");
  const [loanTerm, setLoanTerm] = useState<string>("30");

  const monthlyPayment = useMemo(() => {
    const p = tryParseNumberLike(loanAmount);
    const r = tryParseNumberLike(interestRate) / 100 / 12;
    const n = tryParseNumberLike(loanTerm) * 12;
    if (!p || !r || !n) return 0;
    const payment = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    return payment;
  }, [loanAmount, interestRate, loanTerm]);

  return (
    <div className="grid gap-4">
      <div className="glass rounded-2xl p-4">
        <div className="font-display text-xl tracking-tight">Mortgage / Loan Calculator</div>
        <Separator className="my-4" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-2">
            <div className="text-xs text-muted-foreground">Loan Amount ($)</div>
            <Input value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <div className="text-xs text-muted-foreground">Interest Rate (%)</div>
            <Input value={interestRate} onChange={(e) => setInterestRate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <div className="text-xs text-muted-foreground">Loan Term (Years)</div>
            <Input value={loanTerm} onChange={(e) => setLoanTerm(e.target.value)} />
          </div>
        </div>
        <div className="mt-6 glass rounded-xl px-4 py-3">
          <div className="text-xs text-muted-foreground">Estimated Monthly Payment</div>
          <div className="mt-1 font-display text-3xl tracking-tight text-primary">
            ${formatNumber(monthlyPayment)}
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthCalculator() {
  const [weight, setWeight] = useState<string>("70");
  const [height, setHeight] = useState<string>("175");

  const bmi = useMemo(() => {
    const w = tryParseNumberLike(weight);
    const h = tryParseNumberLike(height) / 100;
    if (!w || !h) return 0;
    return w / (h * h);
  }, [weight, height]);

  const category = bmi < 18.5 ? "Underweight" : bmi < 25 ? "Healthy" : bmi < 30 ? "Overweight" : "Obese";

  return (
    <div className="grid gap-4">
      <div className="glass rounded-2xl p-4">
        <div className="font-display text-xl tracking-tight">BMI Calculator</div>
        <Separator className="my-4" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <div className="text-xs text-muted-foreground">Weight (kg)</div>
            <Input value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <div className="text-xs text-muted-foreground">Height (cm)</div>
            <Input value={height} onChange={(e) => setHeight(e.target.value)} />
          </div>
        </div>
        <div className="mt-6 glass rounded-xl px-4 py-3">
          <div className="flex justify-between">
            <div className="text-xs text-muted-foreground">BMI Score</div>
            <div className="text-xs font-bold text-primary">{category}</div>
          </div>
          <div className="mt-1 font-display text-3xl tracking-tight">
            {formatNumber(bmi)}
          </div>
        </div>
      </div>
    </div>
  );
}

function DateCalculator() {
  const [start, setStart] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [end, setEnd] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });

  const diffDays = useMemo(() => {
    const a = new Date(start + "T00:00:00");
    const b = new Date(end + "T00:00:00");
    const ms = b.getTime() - a.getTime();
    if (!Number.isFinite(ms)) return 0;
    return Math.round(ms / (1000 * 60 * 60 * 24));
  }, [start, end]);

  return (
    <div className="grid gap-4">
      <div className="glass rounded-2xl p-4">
        <div>
          <div
            className="font-display text-xl tracking-tight"
            data-testid="text-date-title"
          >
            Date Calculator
          </div>
          <div
            className="text-sm text-muted-foreground"
            data-testid="text-date-subtitle"
          >
            Count days between two dates.
          </div>
        </div>

        <Separator className="my-4" />

        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <div className="text-xs text-muted-foreground">Start date</div>
            <Input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              data-testid="input-date-start"
            />
          </div>
          <div className="grid gap-2">
            <div className="text-xs text-muted-foreground">End date</div>
            <Input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              data-testid="input-date-end"
            />
          </div>
        </div>

        <div className="mt-4 glass rounded-xl px-4 py-3">
          <div className="text-xs text-muted-foreground">Difference</div>
          <div
            className="mt-1 font-display text-2xl tracking-tight"
            data-testid="text-date-diff"
          >
            {diffDays} days
          </div>
        </div>
      </div>

      <div
        className="text-xs text-muted-foreground"
        data-testid="text-date-footnote"
      >
        Uses local timezone midnight.
      </div>
    </div>
  );
}

function HistoryPanel({
  items,
  onUse,
  onClear,
}: {
  items: HistoryItem[];
  onUse: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <div className="font-display" data-testid="text-history-title">
            History
          </div>
        </div>
        <Button
          variant="secondary"
          onClick={onClear}
          data-testid="button-history-clear"
        >
          Clear
        </Button>
      </div>

      <div className="mt-3 grid gap-2">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid="text-history-empty">
            No calculations yet.
          </div>
        ) : (
          items.map((it) => (
            <button
              key={it.id}
              type="button"
              className="w-full rounded-xl border border-border bg-card/50 px-3 py-3 text-left transition hover:bg-card/70"
              onClick={() => onUse(it.result.replace(/,/g, ""))}
              data-testid={`row-history-${it.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate font-mono text-xs text-muted-foreground"
                    data-testid={`text-history-expr-${it.id}`}
                  >
                    {it.expr}
                  </div>
                  <div
                    className="mt-1 font-display text-lg"
                    data-testid={`text-history-result-${it.id}`}
                  >
                    {it.result}
                  </div>
                </div>
                <div
                  className="text-xs text-muted-foreground"
                  data-testid={`text-history-mode-${it.id}`}
                >
                  {it.mode}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default function CalculatorLab() {
  const { isDark, setIsDark } = useThemeToggle();
  const [mode, setMode] = useState<Mode>("standard");
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const headerIcon =
    mode === "scientific" ? (
      <Sigma className="h-4 w-4" />
    ) : mode === "unit" ? (
      <Ruler className="h-4 w-4" />
    ) : mode === "date" ? (
      <Clock className="h-4 w-4" />
    ) : mode === "finance" ? (
      <Sigma className="h-4 w-4" />
    ) : mode === "health" ? (
      <RefreshCcw className="h-4 w-4" />
    ) : (
      <Calculator className="h-4 w-4" />
    );

  const commitHistory = (item: Omit<HistoryItem, "id" | "at">) => {
    const it: HistoryItem = { id: uid(), at: Date.now(), ...item };
    setHistory((prev) => clampHistory([it, ...prev]));
  };

  const clearHistory = () => setHistory([]);

  return (
    <div className="min-h-screen app-bg">
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="glass soft-focus flex h-12 w-12 items-center justify-center rounded-2xl">
              {headerIcon}
            </div>
            <div>
              <div className="font-display text-2xl tracking-tight" data-testid="text-app-title">
                Calculator Web
              </div>
              <div className="text-sm text-muted-foreground" data-testid="text-app-subtitle">
                Accurate results, multiple calculators, one workspace.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setIsDark(!isDark)}
              data-testid="button-theme-toggle"
            >
              <SunMoon className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                toast({
                  title: "Keyboard tips",
                  description:
                    "Standard mode: type digits/operators, Enter to commit, Esc to clear.",
                });
              }}
              data-testid="button-keyboard-tips"
            >
              <ChevronDown className="h-4 w-4" />
              Tips
            </Button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="glass rounded-3xl border-0 p-4 md:p-6">
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList
                className="grid w-full grid-cols-3 gap-2 md:grid-cols-6"
                data-testid="tabs-calculators"
              >
                <TabsTrigger value="standard" data-testid="tab-standard">
                  Standard
                </TabsTrigger>
                <TabsTrigger value="scientific" data-testid="tab-scientific">
                  Scientific
                </TabsTrigger>
                <TabsTrigger value="unit" data-testid="tab-unit">
                  Units
                </TabsTrigger>
                <TabsTrigger value="date" data-testid="tab-date">
                  Dates
                </TabsTrigger>
                <TabsTrigger value="finance" data-testid="tab-finance">
                  Finance
                </TabsTrigger>
                <TabsTrigger value="health" data-testid="tab-health">
                  Health
                </TabsTrigger>
              </TabsList>

              <div className="mt-5">
                <TabsContent value="standard">
                  <StandardCalc onCommitHistory={commitHistory} />
                </TabsContent>
                <TabsContent value="scientific">
                  <ScientificCalc onCommitHistory={commitHistory} />
                </TabsContent>
                <TabsContent value="unit">
                  <UnitConverter />
                </TabsContent>
                <TabsContent value="date">
                  <DateCalculator />
                </TabsContent>
                <TabsContent value="finance">
                  <FinanceCalculator />
                </TabsContent>
                <TabsContent value="health">
                  <HealthCalculator />
                </TabsContent>
              </div>
            </Tabs>
          </Card>

          <div className="grid gap-4">
            <HistoryPanel
              items={history}
              onUse={(val) => {
                navigator.clipboard
                  .writeText(val)
                  .then(() => toast({ title: "Copied", description: "History value copied." }))
                  .catch(() =>
                    toast({ title: "Copy failed", description: "Couldn’t access clipboard." }),
                  );
              }}
              onClear={clearHistory}
            />

            <div className="glass rounded-2xl p-4">
              <div className="font-display" data-testid="text-accuracy-title">
                Accuracy focus
              </div>
              <div className="mt-2 text-sm text-muted-foreground" data-testid="text-accuracy-body">
                This prototype uses a safe expression parser (no eval) and formats results cleanly. For higher precision (like decimal arithmetic), we can add a decimal engine next.
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard
                      .writeText("(2+3)*4^2")
                      .then(() => toast({ title: "Example copied" }))
                      .catch(() => toast({ title: "Copy failed" }));
                  }}
                  data-testid="button-copy-example"
                >
                  Copy example
                </Button>
                <Button
                  onClick={() => {
                    toast({
                      title: "More calculators",
                      description:
                        "Next we can add: finance (loan/interest), BMI, percentage change, and base converter.",
                    });
                  }}
                  data-testid="button-more-calculators"
                >
                  Add more
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 text-xs text-muted-foreground" data-testid="text-footer">
          Built as a fast UI prototype. If you want saved history / share links, we can upgrade to a full app.
        </div>
      </div>
    </div>
  );
}
