/* eslint-disable @next/next/no-img-element */

export type TokenSymbol = "USDC" | "WETH" | "ETH";

const SRC: Record<TokenSymbol, string> = {
  USDC: "/tokens/usdc.png",
  WETH: "/tokens/weth.svg",
  ETH: "/tokens/eth.png",
};

export function TokenIcon({ symbol, size = 20 }: { symbol: TokenSymbol; size?: number }) {
  return <img className="token-icon" src={SRC[symbol]} alt="" width={size} height={size} aria-hidden />;
}

/// Icon + symbol, for labels and headings.
export function Token({ symbol, size }: { symbol: TokenSymbol; size?: number }) {
  return (
    <span className="token">
      <TokenIcon symbol={symbol} size={size} />
      {symbol}
    </span>
  );
}

/// A segmented token choice: icon, symbol and an optional balance line.
export function TokenPicker<T extends TokenSymbol>({
  options,
  value,
  onChange,
}: {
  options: { symbol: T; detail?: string }[];
  value: T;
  onChange: (symbol: T) => void;
}) {
  return (
    <div className="token-picker" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.symbol}
          type="button"
          role="radio"
          aria-checked={value === o.symbol}
          className={`token-option ${value === o.symbol ? "on" : ""}`}
          onClick={() => onChange(o.symbol)}
        >
          <TokenIcon symbol={o.symbol} size={28} />
          <span className="token-option-text">
            <span className="token-option-symbol">{o.symbol}</span>
            {o.detail && <span className="token-option-detail">{o.detail}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/// An amount input with the token shown inside it, on the right.
export function AmountInput({
  symbol,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  symbol: TokenSymbol;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <span className="amount-input">
      <input inputMode="decimal" value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      <Token symbol={symbol} />
    </span>
  );
}
