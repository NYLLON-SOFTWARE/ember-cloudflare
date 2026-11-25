import type { ProfileAnswer } from "@ember/protocol";
import { connectMemberful, disconnectMemberful } from "@/lib/api";
import { ExternalConnection, type ConnectionProps } from "./external-connection";
import { MemberfulCodeConnection } from "./memberful-code-connection";

// The Memberful section of your profile (`ExternalConnection`): while Memberful is members only, someone
// with an account from before connects their Memberful account to it, with a code Ember emails while it
// can, or on Memberful's page, and signs in with Memberful from then on.

/** Where `connectMemberful` says to sign in at the Memberful site. */
const connect = async (currentPassword?: string) => (await connectMemberful(currentPassword)).memberfulConnection;

interface Props extends ConnectionProps {
  membersOnly: boolean;
  /** Whether Connect asks for a code Ember emails, with Memberful's page the other way (`MemberfulStatus.codes`). */
  codes: boolean;
  /** Your email address, which asking for a code offers as the one your Memberful account has. */
  emailAddress: string;
  /** Shows your profile as connecting with a code answered it. */
  onConnected: (answer: ProfileAnswer) => void;
}

/** The Memberful account you've connected, with Disconnect Memberful, or Connect Memberful. */
export function MemberfulConnection({ membersOnly, codes, emailAddress, onConnected, ...props }: Props) {
  const byCode = codes ? (
    <MemberfulCodeConnection
      hasPassword={props.hasPassword}
      membershipNeeded={props.membershipNeeded}
      emailAddress={emailAddress}
      connectThere={connect}
      onConnected={onConnected}
      onFailed={props.onFailed}
    />
  ) : undefined;
  return <ExternalConnection id="memberful" title="Memberful" name="Memberful" only={membersOnly} connect={connect} disconnect={disconnectMemberful} connectForm={byCode} {...props} />;
}
