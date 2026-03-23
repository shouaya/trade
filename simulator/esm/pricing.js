export function readNumericField(snapshot, snakeField, camelField, fallback) {
    const rawValue = snapshot[snakeField] ?? snapshot[camelField];
    if (rawValue === undefined || rawValue === null || rawValue === '') {
        return fallback;
    }
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) ? numeric : fallback;
}
export function getMidPrice(snapshot) {
    const close = Number(snapshot.close);
    const bidClose = readNumericField(snapshot, 'bid_close', 'bidClose', null);
    const askClose = readNumericField(snapshot, 'ask_close', 'askClose', null);
    if (bidClose !== null && askClose !== null) {
        return (bidClose + askClose) / 2;
    }
    return close;
}
export function getReferencePrice(snapshot, direction, isEntry) {
    const close = Number(snapshot.close);
    const bidClose = readNumericField(snapshot, 'bid_close', 'bidClose', close);
    const askClose = readNumericField(snapshot, 'ask_close', 'askClose', close);
    const resolvedBidClose = bidClose === null ? close : bidClose;
    const resolvedAskClose = askClose === null ? close : askClose;
    if (direction === 'long') {
        return isEntry ? resolvedAskClose : resolvedBidClose;
    }
    return isEntry ? resolvedBidClose : resolvedAskClose;
}
export function getTriggerPrice(snapshot, direction, reason, fallbackPrice) {
    const bidHigh = readNumericField(snapshot, 'bid_high', 'bidHigh', readNumericField(snapshot, 'high', 'high', fallbackPrice));
    const bidLow = readNumericField(snapshot, 'bid_low', 'bidLow', readNumericField(snapshot, 'low', 'low', fallbackPrice));
    const askHigh = readNumericField(snapshot, 'ask_high', 'askHigh', readNumericField(snapshot, 'high', 'high', fallbackPrice));
    const askLow = readNumericField(snapshot, 'ask_low', 'askLow', readNumericField(snapshot, 'low', 'low', fallbackPrice));
    const resolvedBidHigh = bidHigh === null ? fallbackPrice : bidHigh;
    const resolvedBidLow = bidLow === null ? fallbackPrice : bidLow;
    const resolvedAskHigh = askHigh === null ? fallbackPrice : askHigh;
    const resolvedAskLow = askLow === null ? fallbackPrice : askLow;
    if (direction === 'long') {
        return reason === 'stop_loss' ? resolvedBidLow : resolvedBidHigh;
    }
    return reason === 'stop_loss' ? resolvedAskHigh : resolvedAskLow;
}
