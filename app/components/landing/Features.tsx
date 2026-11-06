export function Features() {
  return (
    <section className="band wrap" id="features">
      <div className="kicker">
        <b>The protocol</b> — five guarantees
      </div>
      <div className="landing-h2">Public odds. Private&nbsp;bettors.</div>
      <div className="bento">
        <article className="feat wide">
          <div className="n">01 — SHIELDED BALANCE</div>
          <h3>Deposit once, act privately</h3>
          <p>
            Your USDC becomes a hidden note in a Poseidon Merkle tree. Every bet, claim and swap after
            that is a zero-knowledge proof sent by a relayer: your wallet never appears next to a market.
          </p>
          <div className="isomark" aria-hidden>
            <span className="tile t1" />
            <span className="tile t2" />
            <span className="tile t3" />
          </div>
        </article>
        <article className="feat reg">
          <div className="n">02 — SWAP-AND-BET HOOK</div>
          <h3>Bet straight from a Uniswap swap</h3>
          <p>
            Our v4 hook shields part of any ETH/USDC swap into your private balance in the same
            transaction. A directional fee and an anti-sandwich guard make sandwiches unprofitable.
          </p>
        </article>
        <article className="feat third">
          <div className="n">03 — PRIVATE BATCH SWAPS</div>
          <h3>One swap, many owners</h3>
          <p>Join a batch privately; it executes as one swap through the pool. Everyone gets the same price, pro rata.</p>
        </article>
        <article className="feat third">
          <div className="n">04 — NO HOUSE</div>
          <h3>Chainlink CRE decides</h3>
          <p>A CRE workflow reads ESPN or a Chainlink feed under DON consensus and settles on chain. No admin picks winners.</p>
        </article>
        <article className="feat third">
          <div className="n">05 — LPS GET PAID</div>
          <h3>Bets fund liquidity</h3>
          <p>The 1% market fee is donated to the Uniswap pool&apos;s LPs. The prediction market makes the pool deeper.</p>
        </article>
      </div>
    </section>
  );
}
