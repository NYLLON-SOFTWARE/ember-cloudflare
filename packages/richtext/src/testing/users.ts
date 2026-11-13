import { groupIdFromSgid } from "../mentions";

/** Test user `n`'s id, shaped like Ember's: 16 base-36 characters, as the Worker's `sortableId` makes them. */
export const testUserId = (n: number): string => n.toString(36).padStart(16, "0");

/** Test group `n`'s id, shaped like Ember's, as a group's id is too. */
export const testGroupId = (n: number): string => `g${n.toString(36).padStart(15, "0")}`;

/** Test users by id, and a mention resolver that finds them by their sgid. */
export function testUsers(...names: string[]) {
  const users = new Map(names.map((name, i) => [testUserId(i + 1), { id: testUserId(i + 1), name }]));
  return { users, resolve: (sgid: string) => users.get(sgid) };
}

/** Test groups, by id, each as a mention names one, until the room says whom it stood for. */
export function testGroups(...names: string[]) {
  const groups = new Map(names.map((name, i) => [testGroupId(i + 1), { id: testGroupId(i + 1), name, group: true as const }]));
  return { groups };
}

/** A mention resolver over `users` and `groups`, by the sgids their mentions carry. */
export function testResolver(users: Map<string, { id: string; name: string }>, groups: Map<string, { id: string; name: string; group: true }>) {
  return (sgid: string) => {
    const groupId = groupIdFromSgid(sgid);
    return groupId !== undefined ? groups.get(groupId) : users.get(sgid);
  };
}
