import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { LENDING_ADDRESSES, NETWORK_CONFIG } from '../../config/lendingContracts';
import { LENDING_POOL_ABI } from '../../config/lendingAbis';

const readProvider = new ethers.JsonRpcProvider(NETWORK_CONFIG.rpcUrl);

const TOKENS = [
  { address: LENDING_ADDRESSES.Stablecoin, symbol: 'C5D',  icon: '💵' },
  { address: LENDING_ADDRESSES.MockWETH,   symbol: 'WETH', icon: '⚡' },
];

function fmt(val, d = 2) {
  if (!val && val !== 0n) return '—';
  const n = Number(ethers.formatEther(val));
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const INTERFACE_CODE = `interface IFlashLoanReceiver {
    function executeOperation(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bool);
}`;

const EXAMPLE_CODE = `contract MyArbitrage is IFlashLoanReceiver {
    address pool = 0x...;   // LendingPool address

    function run(uint256 amount) external {
        ILendingPool(pool).flashLoan(
            address(this),   // receiver
            C5D_ADDRESS,     // token
            amount,          // borrow amount
            ""               // extra data
        );
        // ← execution continues here AFTER executeOperation returns
    }

    function executeOperation(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata
    ) external override returns (bool) {
        // 1. Use the funds (arbitrage, liquidation, etc.)
        // ...

        // 2. Approve pool to pull back amount + fee
        IERC20(token).approve(pool, amount + fee);
        return true;
    }
}`;

export default function FlashLoanPage() {
  const [liquidity, setLiquidity] = useState({});
  const [fee, setFee]             = useState(null);
  const [simAmount, setSimAmount] = useState('');
  const [simToken, setSimToken]   = useState(TOKENS[0]);

  useEffect(() => {
    const load = async () => {
      try {
        const pool = new ethers.Contract(LENDING_ADDRESSES.LendingPool, LENDING_POOL_ABI, readProvider);
        const flashFee = await pool.FLASH_LOAN_FEE();
        setFee(flashFee);

        const liq = {};
        for (const t of TOKENS) {
          const [totalSupplied, totalBorrowed] = await pool.getMarketData(t.address);
          liq[t.address] = totalSupplied - totalBorrowed; // available = supplied - borrowed
        }
        setLiquidity(liq);
      } catch (e) {
        console.error('FlashLoanPage load error:', e);
      }
    };
    load();
  }, []);

  const simFee = simAmount && Number(simAmount) > 0 && fee
    ? ethers.parseEther(simAmount) * fee / 10000n
    : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Flash Loans</h1>
        <p className="text-gray-500 text-sm mt-1">
          Borrow any amount of tokens within a single transaction — no collateral required.
          Funds must be repaid (+ fee) before the transaction ends, or the entire tx reverts.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
          <div className="text-3xl font-bold text-blue-600">
            {fee !== null ? `${Number(fee)} bps` : '—'}
          </div>
          <div className="text-sm text-gray-500 mt-1">Flash Loan Fee</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {fee !== null ? `${(Number(fee) / 100).toFixed(2)}% per loan` : ''}
          </div>
        </div>

        {TOKENS.map((t) => (
          <div key={t.address} className="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <div className="text-2xl font-bold text-green-600">
              {liquidity[t.address] !== undefined ? fmt(liquidity[t.address]) : '—'}
            </div>
            <div className="text-sm text-gray-500 mt-1">{t.icon} {t.symbol} Available</div>
            <div className="text-xs text-gray-400 mt-0.5">Max flash loan size</div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="font-semibold text-gray-800 text-lg">How Flash Loans Work</h2>
        <div className="grid grid-cols-4 gap-3 text-sm">
          {[
            { step: '1', title: 'Request',   desc: 'Call flashLoan() on LendingPool with receiver address, token, and amount' },
            { step: '2', title: 'Receive',   desc: 'Pool transfers tokens to your receiver contract in the same transaction' },
            { step: '3', title: 'Execute',   desc: 'Your executeOperation() runs — arbitrage, liquidate, collateral swap, etc.' },
            { step: '4', title: 'Repay',     desc: 'Approve pool for amount + fee. Pool pulls funds back and verifies repayment' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex flex-col items-center text-center p-3 bg-gray-50 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-blue-500 text-white font-bold flex items-center justify-center text-sm mb-2">
                {step}
              </div>
              <div className="font-semibold text-gray-800 mb-1">{title}</div>
              <div className="text-gray-500 text-xs">{desc}</div>
            </div>
          ))}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          If your contract does not approve repayment before returning, or the pool balance
          does not increase by at least the fee, <strong>the entire transaction reverts</strong>.
          No funds are lost — it's as if the flash loan never happened.
        </div>
      </div>

      {/* Fee simulator */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="font-semibold text-gray-800 text-lg">Fee Simulator</h2>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Borrow Amount</label>
            <input
              type="number"
              min="0"
              value={simAmount}
              onChange={(e) => setSimAmount(e.target.value)}
              placeholder="e.g. 10000"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Token</label>
            <div className="flex gap-2">
              {TOKENS.map((t) => (
                <button
                  key={t.address}
                  onClick={() => setSimToken(t)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                    simToken.address === t.address
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t.icon} {t.symbol}
                </button>
              ))}
            </div>
          </div>
        </div>

        {simFee !== null && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-gray-500 text-xs mb-1">Borrow</div>
                <div className="font-bold text-gray-800">{Number(simAmount).toLocaleString()} {simToken.symbol}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs mb-1">Fee (9 bps)</div>
                <div className="font-bold text-orange-600">
                  {fmt(simFee, 4)} {simToken.symbol}
                </div>
              </div>
              <div>
                <div className="text-gray-500 text-xs mb-1">Total Repay</div>
                <div className="font-bold text-blue-600">
                  {fmt(ethers.parseEther(simAmount) + simFee, 4)} {simToken.symbol}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Interface + Example code */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="font-semibold text-gray-800">IFlashLoanReceiver Interface</h2>
          <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-4 overflow-x-auto leading-relaxed">
            {INTERFACE_CODE}
          </pre>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="font-semibold text-gray-800">Example Receiver Contract</h2>
          <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-4 overflow-x-auto leading-relaxed">
            {EXAMPLE_CODE}
          </pre>
        </div>
      </div>

      {/* Use cases */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Common Use Cases</h2>
        <div className="grid grid-cols-3 gap-4 text-sm">
          {[
            { icon: '⚡', title: 'Liquidation',     desc: 'Liquidate undercollateralized positions without needing capital upfront. Borrow debt token, liquidate, sell collateral, repay.' },
            { icon: '🔄', title: 'Collateral Swap', desc: 'Switch your collateral from one asset to another in a single atomic transaction — no intermediate steps needed.' },
            { icon: '📈', title: 'Arbitrage',        desc: 'Exploit price differences across DEXes. Borrow tokens, execute trades, repay. All in one block.' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl mb-2">{icon}</div>
              <div className="font-semibold text-gray-800 mb-1">{title}</div>
              <div className="text-gray-500 text-xs leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
