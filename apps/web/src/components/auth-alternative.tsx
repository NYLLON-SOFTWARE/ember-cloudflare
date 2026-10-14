/**
 * ember-rust's `.mb-auth-alternative` (zz-ember.css): a muted line under a sign-in card offering the
 * other way in. Here it switches the card rather than going to another page, so it's a button, its
 * tap area grown to 44px on touch screens, which a link in running text wouldn't need.
 */
export function AuthAlternative({ question, action, onClick }: { question: string; action: string; onClick: () => void }) {
  return (
    <p className="mt-[22px] text-center text-[13px] text-muted-foreground">
      {question}{" "}
      <button
        type="button"
        onClick={onClick}
        className="relative cursor-pointer text-foreground underline underline-offset-3 touch:after:absolute touch:after:-inset-x-1 touch:after:-inset-y-3.5"
      >
        {action}
      </button>
    </p>
  );
}
