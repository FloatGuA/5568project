export const CONTRACT_ADDRESSES = {
  NFT: import.meta.env.VITE_NFT_ADDRESS || "0x7B34D437B2436929a30847E00fCc181Eda82928b",
  Stablecoin: import.meta.env.VITE_STABLECOIN_ADDRESS || "0x082cb53cfc8945634f11E757aEAA83E80189eB38",
  Marketplace: import.meta.env.VITE_MARKETPLACE_ADDRESS || "0xF0597D85b5a244e0B5495AF427f4D886e6CBAc22",
};

export const NETWORK_CONFIG = {
  chainId: import.meta.env.VITE_CHAIN_ID || "31337",
  chainName: import.meta.env.VITE_CHAIN_NAME || "Localhost",
  rpcUrl: import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545",
};

