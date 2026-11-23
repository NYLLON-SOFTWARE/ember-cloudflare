import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_TOKEN_NAME_LENGTH, type ApiToken, type ApiTokenCreated } from "@ember/protocol";
import { Copy } from "@/components/icons/iconoir";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { Input } from "@/components/ui/input";
import { useMounted } from "@/hooks/use-mounted";
import { createApiToken, fetchApiTokens, isSignedOut, revokeApiToken } from "@/lib/api";

/** Why revoking a token asks first, as the page's other destructive buttons do. */
const CONFIRM_REVOKE = "Revoke this token? Anything opening with it stops working.";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** When `at` was, as the page says it, or nothing yet. */
const shown = (at: number | null) => (at === null ? "never used" : dateFormat.format(new Date(at)));

/** How a made token shows itself once, to copy now. */
const SECRET_FIELD =
  "w-full min-w-0 rounded-[9px] border bg-surface px-[11px] py-[9px] font-mono text-[0.9em] wrap-anywhere select-all";

interface Props {
  /** Says why loading, making or revoking failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * API tokens on your profile: a field to make one with, whose token shows itself once, to copy now,
 * then your tokens, newest first, each with when it was made and when an app last used it, and Revoke,
 * which asks first, since whatever opens with the token stops when it's gone. A token lets one of your
 * own agents read and write your rooms as you, through Ember's MCP server.
 */
export function ApiTokens({ onFailed }: Props) {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  /** The token just made, whose secret is on its way out of the only place it's ever shown. */
  const [made, setMade] = useState<ApiTokenCreated | null>(null);
  /** Whether one is being made, while the form takes no second one, whose answer would hide the first's only shown secret. */
  const [making, setMaking] = useState(false);
  /** The tokens made while this page has been open, newest first, since the list was asked for. */
  const madeTokens = useRef<ApiToken[]>([]);
  /** The tokens revoked while this page has been open, since the list was asked for. */
  const revokedIds = useRef<Set<string>>(new Set());
  const nameInput = useRef<HTMLInputElement>(null);
  const mounted = useMounted();

  /** The list as the page has it: the server's, with the tokens made here that it doesn't know of in, and the ones revoked here out, however their reads and changes went in. */
  const withLocalChanges = (list: ApiToken[]): ApiToken[] => {
    const revoked = revokedIds.current;
    const kept = list.filter((token) => !revoked.has(token.id));
    const listed = new Set(kept.map((token) => token.id));
    const made = madeTokens.current.filter((token) => !revoked.has(token.id) && !listed.has(token.id));
    return [...made, ...kept];
  };

  useEffect(() => {
    let stopped = false;
    fetchApiTokens().then(
      (tokens) => {
        if (!stopped) setTokens(withLocalChanges(tokens ?? []));
      },
      (error: unknown) => {
        if (!stopped || isSignedOut(error)) onFailed(error);
      },
    );
    return () => void (stopped = true);
  }, [onFailed]);

  // The made token's secret leaves its field once the page has gone, like a password typed does.
  useEffect(() => () => setMade(null), []);

  const make = (event: FormEvent) => {
    event.preventDefault();
    if (making) return;
    const name = nameInput.current?.value.trim() ?? "";
    if (!name) return;
    setMaking(true);
    createApiToken(name).then(
      (created) => {
        setMaking(false);
        if (!mounted.current) return;
        madeTokens.current = [created, ...madeTokens.current];
        setMade(created);
        // A list still loading has nothing to put the token in, so the ones made here hold its place.
        setTokens((tokens) => withLocalChanges([created, ...(tokens ?? [])]));
        if (nameInput.current) nameInput.current.value = "";
      },
      (error: unknown) => {
        setMaking(false);
        if (mounted.current || isSignedOut(error)) onFailed(error);
      },
    );
  };

  const revoke = (id: string) => {
    if (!confirm(CONFIRM_REVOKE)) return;
    revokeApiToken(id).then(
      () => {
        if (!mounted.current) return;
        revokedIds.current.add(id);
        madeTokens.current = madeTokens.current.filter((token) => token.id !== id);
        setTokens((tokens) => withLocalChanges((tokens ?? []).filter((token) => token.id !== id)));
      },
      (error: unknown) => {
        if (mounted.current || isSignedOut(error)) onFailed(error);
      },
    );
  };

  // The clipboard is missing on plain http, where the page may still be read.
  const copy = (secret: string) => void Promise.resolve(navigator.clipboard?.writeText(secret)).catch(() => {});

  return (
    <div className="my-4 rounded-[10px] border bg-surface px-[1ch] py-4">
      <h2 id="tokens-heading" className="mb-3 text-base font-semibold">
        API tokens
      </h2>
      <p className="mb-4 text-[0.8em] text-muted-foreground">
        Let one of your own agents read and write your rooms as you, through Ember's MCP server. It acts as you, in your rooms and no one else's.
      </p>
      <form onSubmit={make} className="mb-4 flex flex-col gap-[7px]">
        <Field id="token_name" label="Name the token for what it opens">
          <div className="flex items-center gap-[1ch]">
            <Input
              id="token_name"
              placeholder="My deploy bot"
              maxLength={MAX_TOKEN_NAME_LENGTH}
              ref={nameInput}
              className={FIELD_INPUT}
            />
            <SubmitButton disabled={making} className="w-auto">
              Create token
            </SubmitButton>
          </div>
        </Field>
      </form>
      {made && (
        <div className="mb-4 flex flex-col gap-[7px]" data-testid="made-token">
          <div className="flex items-start gap-[1ch]">
            <output aria-label="Your new token" className={SECRET_FIELD}>
              {made.token}
            </output>
            <button
              type="button"
              aria-label="Copy token"
              onClick={() => copy(made.token)}
              className="flex size-11 shrink-0 items-center justify-center rounded-[9px] border bg-background"
            >
              <Copy className="size-5" />
            </button>
          </div>
          <p className="text-[0.8em] text-muted-foreground">Copy it now. It won't be shown again.</p>
        </div>
      )}
      {tokens && tokens.length > 0 && (
        <menu aria-labelledby="tokens-heading" className="m-0 flex flex-col gap-x-[1ch] gap-y-4 px-[1ch] py-4">
          {tokens.map((token) => (
            <li key={token.id} className="flex min-w-0 items-center gap-x-[1ch]">
              <span className="min-w-0 flex-1">
                <strong className="truncate">{token.name}</strong>
                <span className="block text-[0.8em] text-muted-foreground">
                  Made {dateFormat.format(new Date(token.createdAt))} · Last used {shown(token.lastUsedAt)}
                  {token.revokedAt !== null && " · Revoked"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => revoke(token.id)}
                className="min-h-11 shrink-0 rounded-[9px] border bg-negative-button px-3 py-2.5 text-sm font-[550] text-white"
              >
                Revoke
              </button>
            </li>
          ))}
        </menu>
      )}
    </div>
  );
}
