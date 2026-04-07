import { useState, useEffect, useMemo, useCallback } from 'react';
import { ethers } from 'ethers';
import { ShoppingCart, DollarSign, RefreshCw } from 'lucide-react';
import { useWeb3 } from '../hooks/useWeb3';
import { CONTRACT_ADDRESSES, NETWORK_CONFIG } from '../config/contracts';
import { NFT_ABI, MARKETPLACE_ABI, STABLECOIN_ABI } from '../config/abis';

const MARKETPLACE_START_BLOCK = Number(import.meta.env.VITE_MARKETPLACE_START_BLOCK ?? 0);
const DEFAULT_GATEWAY = import.meta.env.VITE_IPFS_GATEWAY ?? 'https://ipfs.io/ipfs/';

const normalizeUri = (uri) => {
  if (!uri) return '';
  if (uri.startsWith('ipfs://')) {
    return `${DEFAULT_GATEWAY}${uri.replace('ipfs://', '')}`;
  }
  return uri;
};

const decodeDataUriImage = (uri) => {
  if (!uri?.startsWith('data:application/json')) {
    return { image: normalizeUri(uri), raw: uri };
  }
  try {
    const [, payload] = uri.split(',');
    const json = JSON.parse(atob(payload));
    return {
      image: json.image ? normalizeUri(json.image) : '',
      raw: uri,
      name: json.name,
      description: json.description,
    };
  } catch {
    return { image: '', raw: uri };
  }
};

const fetchMetadataFromUri = async (uri) => {
  const normalized = normalizeUri(uri);
  if (!normalized) return { tokenURI: '', image: '', name: '', description: '' };

  if (normalized.startsWith('data:')) {
    return { ...decodeDataUriImage(normalized), tokenURI: normalized };
  }

  if (normalized.endsWith('.json') || normalized.includes('.json?')) {
    try {
      const resp = await fetch(normalized);
      if (!resp.ok) throw new Error('metadata fetch failed');
      const meta = await resp.json();
      return {
        tokenURI: normalized,
        image: meta.image ? normalizeUri(meta.image) : '',
        name: meta.name,
        description: meta.description,
      };
    } catch (err) {
      console.warn('获取 metadata 失败', normalized, err);
      return { tokenURI: normalized, image: '', name: '', description: '' };
    }
  }

  return { tokenURI: normalized, image: normalized, name: '', description: '' };
};

export default function Marketplace() {
  const { signer, provider, account, isConnected } = useWeb3();
  // 优先用signer，其次provider, 最后rpc
  const rpcProvider = useMemo(() => {
    try {
      return new ethers.JsonRpcProvider(NETWORK_CONFIG.rpcUrl);
    } catch (e) {
      return null;
    }
  }, []);

  const readProvider = signer ?? provider ?? rpcProvider;
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stablecoinBalance, setStablecoinBalance] = useState('0');

  // Ready when a read provider is available (allow browsing without wallet)
  const isReady = useMemo(() => Boolean(readProvider), [readProvider]);

  const loadStablecoinBalance = useCallback(async () => {
    if (!account || !readProvider) return;
    try {
      const stablecoinContract = new ethers.Contract(
        CONTRACT_ADDRESSES.Stablecoin,
        STABLECOIN_ABI,
        readProvider
      );
      const [balance, decimals] = await Promise.all([
        stablecoinContract.balanceOf(account),
        // decimals may be undefined on some ERC20s; default to 18
        (async () => {
          try {
            return await stablecoinContract.decimals();
          } catch {
            return 18;
          }
        })(),
      ]);
      setStablecoinBalance(ethers.formatUnits(balance, Number(decimals ?? 18)));
    } catch (err) {
      console.error('加载稳定币余额失败:', err);
    }
  }, [account, readProvider]);

  // ---- 关键逻辑：只以合约实际listings里的active = true展示 ---- //
  const loadListings = useCallback(async () => {
    if (!readProvider) {
      setError('No RPC/provider available — set VITE_RPC_URL or connect a wallet');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const marketplaceContract = new ethers.Contract(
        CONTRACT_ADDRESSES.Marketplace,
        MARKETPLACE_ABI,
        readProvider
      );
      const nftContract = new ethers.Contract(CONTRACT_ADDRESSES.NFT, NFT_ABI, readProvider);
      const stablecoinContract = new ethers.Contract(CONTRACT_ADDRESSES.Stablecoin, STABLECOIN_ABI, readProvider);

      let stablecoinDecimals = 18;
      try {
        stablecoinDecimals = Number(await stablecoinContract.decimals());
      } catch (e) {}

      // 获取所有Listed事件
      const listedEvents = await marketplaceContract.queryFilter(
        marketplaceContract.filters.Listed(CONTRACT_ADDRESSES.NFT),
        MARKETPLACE_START_BLOCK,
        'latest'
      );

      // 提取所有tokenId, 对每个tokenId查询链上listings状态
      const tokenIds = Array.from(
        new Set(listedEvents.map(e => e.args.tokenId.toString()))
      );

      const enrichedListings = await Promise.all(
        tokenIds.map(async (tokenId) => {
          // 查询合约listings映射真实状态
          let listingOnChain;
          try {
            listingOnChain = await marketplaceContract.listings(CONTRACT_ADDRESSES.NFT, tokenId);
          } catch (e) {
            return null; // 跳过异常
          }
          if (!listingOnChain.active) return null; // 只要active

          let metadata = { tokenURI: '', image: '', name: '', description: '' };
          if (typeof nftContract.tokenURI === 'function') {
            try {
              const uri = await nftContract.tokenURI(BigInt(tokenId));
              metadata = await fetchMetadataFromUri(uri);
            } catch (metaErr) {
              console.warn(`tokenId ${tokenId} 元数据获取失败`, metaErr);
            }
          }

          // 能拿的事件信息（如blockNumber, txHash等）补充到item
          const eventInfo = listedEvents.find(e => e.args.tokenId.toString() === tokenId);

          return {
            tokenId: Number(tokenId),
            seller: listingOnChain.seller,
            priceWei: listingOnChain.price,
            price: ethers.formatUnits(listingOnChain.price, stablecoinDecimals),
            metadata,
            blockNumber: eventInfo?.blockNumber,
            txHash: eventInfo?.transactionHash,
            active: listingOnChain.active
          };
        })
      );

      setListings(
        enrichedListings
          .filter(Boolean)
          .sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0))
      );
    } catch (err) {
      console.error('加载列表失败:', err);
      setError(err.message ?? '加载NFT列表失败');
    } finally {
      setLoading(false);
    }
  }, [readProvider]);

  useEffect(() => {
    if (!isReady) return;
    loadListings();
    loadStablecoinBalance();
  }, [isReady, loadListings, loadStablecoinBalance]);

  // 购买
  const handleBuy = async (tokenId, price) => {
    if (!signer || !account) {
      alert('请先连接钱包并确保已授权交易');
      return;
    }
    try {
      setLoading(true);
      const marketplaceContract = new ethers.Contract(
        CONTRACT_ADDRESSES.Marketplace,
        MARKETPLACE_ABI,
        signer
      );
      const stablecoinContract = new ethers.Contract(
        CONTRACT_ADDRESSES.Stablecoin,
        STABLECOIN_ABI,
        signer
      );
      const priceWei = ethers.parseUnits(price, 18);
      const allowance = await stablecoinContract.allowance(account, CONTRACT_ADDRESSES.Marketplace);
      if (allowance < priceWei) {
        const approveTx = await stablecoinContract.approve(CONTRACT_ADDRESSES.Marketplace, priceWei);
        await approveTx.wait();
      }
      const tx = await marketplaceContract.buyNFT(CONTRACT_ADDRESSES.NFT, tokenId);
      await tx.wait();
      alert('购买成功！');
      await Promise.all([loadListings(), loadStablecoinBalance()]);
    } catch (err) {
      alert('购买失败: ' + err.message);
      console.error('购买失败:', err);
    } finally {
      setLoading(false);
    }
  };

  // ui provider类型
  const providerType = useMemo(() => {
    if (signer) return 'wallet (signer)';
    if (provider) return 'wallet (provider)';
    if (rpcProvider) return 'rpc';
    return 'none';
  }, [signer, provider, rpcProvider]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">NFT 市场</h2>
          <p className="text-sm text-gray-500">实时列出当前在售的 NFT</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg">
            <DollarSign size={20} className="text-blue-600" />
            <span className="font-medium">
              余额: {Number(stablecoinBalance).toFixed(2)} C5D
            </span>
          </div>
          <button
            onClick={loadListings}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-2 border rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>
      {!isConnected && (
        <div className="p-3 bg-yellow-50 border border-yellow-100 rounded text-yellow-800">
          未连接钱包：您可以浏览市场并查看 NFT，购买前请连接钱包。
        </div>
      )}

      <div className="mt-3 p-3 bg-gray-50 border border-gray-100 rounded text-sm text-gray-600">
        <div className="font-medium text-gray-700 mb-1">调试信息</div>
        <div>RPC: <span className="font-mono">{NETWORK_CONFIG.rpcUrl || '—'}</span></div>
        <div>NFT 合约: <span className="font-mono">{CONTRACT_ADDRESSES.NFT}</span></div>
        <div>Marketplace 合约: <span className="font-mono">{CONTRACT_ADDRESSES.Marketplace}</span></div>
        <div>Stablecoin 合约: <span className="font-mono">{CONTRACT_ADDRESSES.Stablecoin}</span></div>
        <div>Provider: <span className="font-mono">{providerType}</span></div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {loading && listings.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">加载中...</p>
        </div>
      ) : listings.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">暂无 NFT 在售</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => (
            <div key={listing.tokenId} className="border rounded-lg p-4 hover:shadow-lg transition-shadow space-y-3">
              <div className="aspect-square bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden">
                {listing.metadata.image ? (
                  <img
                    src={listing.metadata.image}
                    alt={`NFT #${listing.tokenId}`}
                    className="w-full h-full object-cover"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                ) : (
                  <span className="text-gray-400">NFT #{listing.tokenId}</span>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-sm text-gray-500">Token #{listing.tokenId}</p>
                {listing.metadata.name && (
                  <p className="text-lg font-semibold">{listing.metadata.name}</p>
                )}
                <p className="text-sm text-gray-500">
                  卖家: {listing.seller.slice(0, 6)}...{listing.seller.slice(-4)}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold text-blue-600">{listing.price} C5D</span>
                <button
                  onClick={() => handleBuy(listing.tokenId, listing.price)}
                  disabled={loading || listing.seller.toLowerCase() === account?.toLowerCase()}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                >
                  <ShoppingCart size={16} />
                  购买
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}