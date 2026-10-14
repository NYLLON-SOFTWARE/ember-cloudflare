import { feature } from "@ember/parity";
import { avatarSvg, type DirectoryUser } from "@ember/protocol";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { UserAvatar } from "./user-avatar";

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
});
