import { render, screen } from "@testing-library/react";
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonMood } from "@ember/protocol";
import { Mood } from "./mood";

const worn = (clearAt: string | null): PersonMood => ({ emoji: "😌", text: "Pairing on the compiler", clearAt });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T18:00:00"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Mood", () => {
  it("wears what someone wears beside their name, muted", () => {
    render(<Mood mood={worn(null)} />);
    expect(screen.getByText("😌 Pairing on the compiler")).toHaveClass("truncate", "text-muted-foreground");
  });

  it("takes a mood off when its clear time arrives, though nothing else says it has", () => {
    render(<Mood mood={worn(new Date("2026-10-12T18:01:00").toISOString())} />);
    expect(screen.getByText("😌 Pairing on the compiler")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByText(/^😌/)).toBeNull();
  });

  it("wears nothing once a clear time has passed, and nothing for nobody's mood", () => {
    render(<Mood mood={worn(new Date("2026-10-12T17:59:00").toISOString())} />);
    expect(screen.queryByText(/^😌/)).toBeNull();
  });

  it("wears a mood with no clear time until it's taken off, however long", () => {
    render(<Mood mood={worn(null)} />);
    act(() => vi.advanceTimersByTime(24 * 3_600_000));
    expect(screen.getByText("😌 Pairing on the compiler")).toBeInTheDocument();
  });
});
