import { gmoVenueResolver } from './gmo.js';
const VENUE_RESOLVERS = {
    gmo: gmoVenueResolver,
    gmocoin: gmoVenueResolver,
    'gmo-coin': gmoVenueResolver,
};
function normalizeVenue(venue) {
    return String(venue || 'gmo').trim().toLowerCase();
}
export function getVenueResolver(venue) {
    const resolver = VENUE_RESOLVERS[normalizeVenue(venue)];
    if (!resolver) {
        throw new Error(`Unsupported simulator venue: ${String(venue)}`);
    }
    return resolver;
}
export function resolveVenueSymbolSpec(params) {
    return getVenueResolver(params.venue).resolveSymbolSpec(params);
}
export function resolveVenueFeeModel(params) {
    return getVenueResolver(params.venue).resolveFeeModel(params);
}
