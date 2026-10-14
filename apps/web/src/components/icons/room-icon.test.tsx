import { feature } from "@ember/parity";
import { ROOM_ICON_NAMES } from "@ember/protocol";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import catalog from "./lucide/catalog.json";
import { RoomIcon, roomIconLabel, roomIconUrl } from "./room-icon";

describe(feature("rooms.icons"), () => {
  it("draws `#` for a room without an icon, in the size of the text around it", () => {
    const { container } = render(<RoomIcon icon={null} size={19} className="text-[22px]" />);
    expect(container.innerHTML).toBe('<span aria-hidden="true" class="text-[22px]">#</span>');
  });

  it("draws an icon in the color of the text around it, from the icon's own address, at the size given", () => {
    const { container } = render(<RoomIcon icon="coffee" size={19} className="text-muted-foreground" />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveAttribute("aria-hidden", "true");
    expect(outer).toHaveClass("inline-flex", "text-muted-foreground");
    const icon = outer.querySelector<HTMLElement>('[data-icon="coffee"]')!;
    expect(icon).toHaveClass("bg-current");
    expect(icon.style.width).toBe("19px");
    expect(icon.style.height).toBe("19px");
    expect(icon.style.maskImage).toBe('url("/lucide/icons/coffee.svg")');
    expect(outer).toHaveTextContent("");
  });

  it("serves each icon at an address of its own", () => {
    expect(roomIconUrl("gamepad-2")).toBe("/lucide/icons/gamepad-2.svg");
  });

  it("names every icon as the catalog does, and the default Default hashtag", () => {
    expect(catalog.map((icon) => icon.name)).toEqual(ROOM_ICON_NAMES);
    expect(catalog.filter((icon) => roomIconLabel(icon.name as (typeof ROOM_ICON_NAMES)[number]) !== icon.label)).toEqual([]);
    expect(roomIconLabel("gamepad-2")).toBe("Gamepad 2");
    expect(roomIconLabel(null)).toBe("Default hashtag");
  });
});
