import { gmoVenueResolver } from './gmo.js';
import type {
  FeeModelConfig,
  ResolveVenueFeeModelParams,
  ResolveVenueSymbolSpecParams,
  SymbolSpec,
  VenueResolver,
} from '../types.js';

const VENUE_RESOLVERS: Record<string, VenueResolver> = {
  gmo: gmoVenueResolver,
  gmocoin: gmoVenueResolver,
  'gmo-coin': gmoVenueResolver,
};

function normalizeVenue(venue?: string): string {
  return String(venue || 'gmo').trim().toLowerCase();
}

export function getVenueResolver(venue?: string): VenueResolver {
  const resolver = VENUE_RESOLVERS[normalizeVenue(venue)];
  if (!resolver) {
    throw new Error(`Unsupported simulator venue: ${String(venue)}`);
  }

  return resolver;
}

export function resolveVenueSymbolSpec(params: ResolveVenueSymbolSpecParams): SymbolSpec {
  return getVenueResolver(params.venue).resolveSymbolSpec(params);
}

export function resolveVenueFeeModel(params: ResolveVenueFeeModelParams): FeeModelConfig {
  return getVenueResolver(params.venue).resolveFeeModel(params);
}
