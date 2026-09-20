/**
 * The chain a payment settles on, named for a reader.
 *
 * One table, so the paywall, the checkout notices and the Market Desk offer cannot describe the
 * same network differently. An id this does not know is shown exactly as the API sent it rather
 * than guessed at, and the raw CAIP-2 id stays available: nothing here replaces the identifier a
 * wallet is actually asked to sign for.
 */
const NETWORK_NAMES: Record<string, string> = { "eip155:196": "X Layer", "eip155:1952": "X Layer testnet" };

export const networkName = (id: string): string => NETWORK_NAMES[id] ?? id;
