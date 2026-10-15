import { feature } from "@ember/parity";
import { avatarSvg, type DirectoryUser, type User } from "@ember/protocol";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { DRAWINGS_KEPT, UserAvatar } from "./user-avatar";

const ada: DirectoryUser = { id: "u1", name: "Ada Lovelace", bio: null, role: "member", status: "active", avatarUrl: "/users/u1.abc/avatar?v=20261014120000" };

/** Ada's initials, drawn in the page as the Worker draws them. */
const drawn = `data:image/svg+xml;base64,${btoa(avatarSvg(ada.id, ada.name))}`;

/** The image `avatar` draws, with the directory listing `people`. */
function picture(avatar: React.ReactElement, people: People = new Map([[ada.id, ada]])) {
  const { container, rerender } = render(<PeopleContext value={people}>{avatar}</PeopleContext>);
  return { image: container.querySelector("img")!, rerender: (next: People) => rerender(<PeopleContext value={next}>{avatar}</PeopleContext>) };
}

describe(feature("users.avatars"), () => {
  it("shows the image the directory gives the address of, over the initials, hidden from screen readers", () => {
    const { image } = picture(<UserAvatar user={ada} />);
    expect(image).toHaveAttribute("src", ada.avatarUrl);
    expect(image.style.backgroundImage).toBe(`url("${drawn}")`);
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(image).not.toHaveAttribute("loading");
  });

  it("draws the initials while the directory doesn't list someone", () => {
    expect(picture(<UserAvatar user={ada} />, new Map()).image).toHaveAttribute("src", drawn);
  });

  it("draws the initials of the name the directory lists, which follows a rename since the user was copied", () => {
    const renamed = { ...ada, name: "Grace Hopper" };
    const { image } = picture(<UserAvatar user={ada} />, new Map([[ada.id, renamed]]));
    expect(image.style.backgroundImage).toBe(`url("data:image/svg+xml;base64,${btoa(avatarSvg(ada.id, "Grace Hopper"))}")`);
  });

  it("goes back to the initials when the image can't load, until the directory gives another", () => {
    const { image, rerender } = picture(<UserAvatar user={ada} />);
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", drawn);
    const changed = { ...ada, avatarUrl: "/users/u1.abc/avatar?v=20261015120000" };
    rerender(new Map([[ada.id, changed]]));
    expect(image).toHaveAttribute("src", changed.avatarUrl);
  });

  it("waits to load in lists until it's scrolled near", () => {
    expect(picture(<UserAvatar user={ada} lazy />).image).toHaveAttribute("loading", "lazy");
  });

  it("keeps the initials it drew for only as many people as a page could show, the ones shown last", () => {
    const drawing = vi.spyOn(globalThis, "btoa");
    const someone = (n: number): User => ({ id: `shown-${n}`, name: `Someone ${n}` });
    const show = (people: User[]) => render(<PeopleContext value={new Map()}>{people.map((user, index) => <UserAvatar key={index} user={user} />)}</PeopleContext>).unmount();

    show([someone(0), someone(0)]);
    expect(drawing).toHaveBeenCalledOnce();
    show(Array.from({ length: DRAWINGS_KEPT - 1 }, (_, n) => someone(n + 1)));
    // Shown again, the first is the one shown last, so someone new takes the second's place instead.
    show([someone(0)]);
    show([someone(DRAWINGS_KEPT)]);
    expect(drawing).toHaveBeenCalledTimes(DRAWINGS_KEPT + 1);
    show([someone(0)]);
    expect(drawing).toHaveBeenCalledTimes(DRAWINGS_KEPT + 1);
    show([someone(1)]);
    expect(drawing).toHaveBeenCalledTimes(DRAWINGS_KEPT + 2);
    drawing.mockRestore();
  });
});
