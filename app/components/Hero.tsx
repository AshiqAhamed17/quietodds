"use client";

import { motion } from "framer-motion";

const ease = [0.2, 0.7, 0.2, 1] as const;

export function Hero() {
  return (
    <section className="hero3d">
      <div className="hero3d-inner">
        <motion.p
          className="hero-eyebrow"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          Private bets · private swaps · Uniswap v4
        </motion.p>
        <motion.h1
          className="wordmark hero3d-wordmark"
          initial={{ opacity: 0, y: 18, filter: "blur(16px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.3, ease, delay: 0.3 }}
        >
          QUIETODDS
        </motion.h1>
        <motion.p
          className="hero3d-tag"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.9 }}
        >
          Bet on anything, <em>privately</em>. Swap on Uniswap, <em>quietly</em>.
        </motion.p>
      </div>

      <motion.div
        className="hero3d-foot"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.2 }}
      >
        <span>
          Built with <b>Noir</b> · <b>Uniswap v4</b> · <b>Chainlink CRE</b> · <b>Anon-RPC</b>
        </span>
        <span className="scrollcue">Scroll to explore ↓</span>
      </motion.div>
    </section>
  );
}
