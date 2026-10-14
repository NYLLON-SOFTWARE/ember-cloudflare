/**
 * ember-rust's `.mb-auth-alternative` (zz-ember.css): a muted line under a sign-in card offering the
 * other way in. Here it switches the card rather than going to another page, so it's a button, its
 * tap area grown to 44px on touch screens, which a link in running text wouldn't need. It waits
 * while the card's form is signing in, so only one sign-in is ever on its way.
 */
export function AuthAlternative({ question, action, onClick, disabled }: { question: string; action: string; onClick: () => void; disabled?: boolean }) {
  return (
    <p className="mt-[22px] text-center text-[13px] text-muted-foreground">
      {question}{" "}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="relative cursor-pointer text-foreground underline underline-offset-3 touch:after:absolute touch:after:-inset-x-1 touch:after:-inset-y-3.5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {action}
      </button>
    </p>
  );
}
