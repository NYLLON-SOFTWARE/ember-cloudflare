import type { ReactNode } from "react";
import {
  offeredModelOf,
  SUGGESTED_MODEL,
  type AssistantField,
  type AssistantModel,
  type ModelPrice,
} from "@ember/protocol/assistant";
import { FIELD_INPUT, Field } from "@/components/field";
import { cn } from "@/lib/utils";

// The menu of the models @ember can answer with, which Set up Ember AI, Add a model and the agents' pages
// share: the ones Ember offers, by their makers, with what they cost, and the one kept already, when Ember
// no longer offers it. Under it, what the model chosen costs, and where the credits that pay for it are
// topped up.

export const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";
export const SELECT = cn("w-full min-w-0 border outline-none dark:bg-input/30", FIELD_INPUT);

/**
 * The page at `path` in the Cloudflare dashboard, in the account `accountId` names, or else in the one
 * the dashboard picks, asking someone with several accounts which.
 */
export const dashboard = (accountId: string | null, path: string) =>
  accountId === null ? `https://dash.cloudflare.com/?to=/:account/${path}` : `https://dash.cloudflare.com/${accountId}/${path}`;

/** Where AI Gateway's credits are topped up, under Credits Available, in the Cloudflare dashboard. */
const aiGatewayDashboard = (accountId: string | null) => dashboard(accountId, "ai/ai-gateway");

/** What a model kept before Ember stopped offering it is called beside its name. */
export const NO_LONGER_OFFERED = "no longer offered";

/** Who makes the models Ember offers, by the start of their IDs, as the menu groups them. */
const MAKERS = [
  { prefix: "anthropic/", label: "Anthropic" },
  { prefix: "openai/", label: "OpenAI" },
  { prefix: "xai/", label: "xAI" },
] as const;

/** Why a field is refused, said on it, or else, with no field, under the step's. */
export interface Refusal {
  field: AssistantField | null;
  error: string;
}

/** What the menu starts at: `model`, Ember AI's or an agent's, while Ember offers it, or else the model it suggests. */
export const startingModelOf = (model: string | null) => (model !== null && offeredModelOf(model) ? model : SUGGESTED_MODEL);

/** `amount` in US dollars, with cents, or fractions of a cent, when it has them. */
export const dollars = (amount: number) =>
  amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 3 });

/** What `price` says, as a model's menu entry shows it: what a million tokens read costs, then a million written. */
const shortPrice = ({ input, output }: ModelPrice) => `${dollars(input)} / ${dollars(output)}`;

/** A link out, which opens in a new tab. */
export function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="underline">
      {children}
    </a>
  );
}

/** Why `field` is refused, under it, if it is. */
export function FieldRefusal({ id, field, refusal }: { id: string; field: AssistantField; refusal: Refusal | null }) {
  if (refusal?.field !== field) return null;
  return (
    <p id={id} role="alert" className={cn(NOTE, "mt-2 wrap-anywhere text-negative")}>
      {refusal.error}
    </p>
  );
}

interface Props {
  /** The models to list, of those Ember offers. */
  models: readonly AssistantModel[];
  /** The model kept already, when Ember no longer offers it, which the menu lists after the others. */
  kept?: Pick<AssistantModel, "id" | "name"> | null;
  chosen: string;
  onChoose: (model: string) => void;
  refusal: Refusal | null;
  disabled: boolean;
  /** The Cloudflare account whose AI Gateway's credits pay for the models. */
  accountId: string | null;
}

/** The menu of `models`, by their makers, and of the one `kept`, if Ember no longer offers it, and under it what the one chosen costs. */
export function ModelPicker({ models, kept = null, chosen, onChoose, refusal, disabled, accountId }: Props) {
  const price = offeredModelOf(chosen)?.price;
  const modelRefused = refusal?.field === "model";
  const groups = MAKERS.map(({ prefix, label }) => ({ label, models: models.filter(({ id }) => id.startsWith(prefix)) }));

  return (
    <>
      <Field id="assistant_model" label="Model">
        <select
          id="assistant_model"
          value={chosen}
          disabled={disabled}
          aria-invalid={modelRefused}
          aria-describedby={modelRefused ? "assistant-model-refusal" : "assistant-model-cost"}
          onChange={(event) => onChoose(event.target.value)}
          className={SELECT}
        >
          {groups.map(
            (group) =>
              group.models.length > 0 && (
                <optgroup key={group.label} label={group.label}>
                  {group.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.price ? `${model.name} · ${shortPrice(model.price)}` : model.name}
                    </option>
                  ))}
                </optgroup>
              ),
          )}
          {kept && (
            <option value={kept.id}>
              {kept.name} ({NO_LONGER_OFFERED})
            </option>
          )}
        </select>
      </Field>
      <FieldRefusal id="assistant-model-refusal" field="model" refusal={refusal} />
      <p id="assistant-model-cost" className={cn(NOTE, "mt-2")}>
        {price ? (
          <>
            AI Gateway's credits pay for this model, {dollars(price.input)} for each million tokens it reads, and {dollars(price.output)} for each million it
            writes. Top them up under <em>Credits Available</em> in AI Gateway. <Out href={aiGatewayDashboard(accountId)}>Open AI Gateway in the Cloudflare dashboard</Out>
          </>
        ) : (
          "Ember no longer offers this model. It answers as it did until you choose one that Ember offers."
        )}
      </p>
    </>
  );
}
