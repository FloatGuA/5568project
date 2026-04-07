import { ethers } from 'ethers';
window.ethers = ethers;
import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import WalletConnect from './components/WalletConnect';
import Marketplace from './components/Marketplace';
import MyNFTs from './components/MyNFTs';
import MintNFT from './components/MintNFT';
import MintStablecoin from './components/MintStablecoin';
// Lending Protocol Pages
import Dashboard from './components/lending/Dashboard';
import LendingPage from './components/lending/LendingPage';
import BorrowPage from './components/lending/BorrowPage';
import LiquidationPage from './components/lending/LiquidationPage';
import FlashLoanPage from './components/lending/FlashLoanPage';
import './App.css';

const NAV_SECTIONS = [
  {
    label: '🏦 Lending Protocol',
    links: [
      { to: '/',        label: 'Dashboard'  },
      { to: '/supply',  label: 'Supply'     },
      { to: '/borrow',     label: 'Borrow'      },
      { to: '/liquidate',   label: 'Liquidate'    },
      { to: '/flash-loan',  label: 'Flash Loan'   },
    ],
  },
  {
    label: '🖼 NFT Marketplace',
    links: [
      { to: '/marketplace',     label: 'Market'       },
      { to: '/my-nfts',         label: 'My NFTs'      },
      { to: '/mint-nft',        label: 'Mint NFT'     },
      { to: '/mint-stablecoin', label: 'Mint C5D'     },
    ],
  },
];

function Navigation() {
  const location = useLocation();

  return (
    <nav className="bg-white border-b shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <Link to="/" className="text-xl font-bold text-blue-600 whitespace-nowrap">
              COMP5568 DeFi
            </Link>

            {/* Nav links grouped by section */}
            <div className="hidden md:flex items-center gap-1">
              {NAV_SECTIONS.map((section) => (
                <div key={section.label} className="flex items-center">
                  <span className="text-xs text-gray-400 px-2">{section.label}</span>
                  {section.links.map((link) => (
                    <Link
                      key={link.to}
                      to={link.to}
                      className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                        location.pathname === link.to
                          ? 'bg-blue-100 text-blue-700 font-medium'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <WalletConnect />
        </div>
      </div>
    </nav>
  );
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Routes>
            {/* Lending Protocol */}
            <Route path="/"        element={<Dashboard   />} />
            <Route path="/supply"  element={<LendingPage />} />
            <Route path="/borrow"     element={<BorrowPage      />} />
            <Route path="/liquidate"  element={<LiquidationPage />} />
            <Route path="/flash-loan" element={<FlashLoanPage   />} />

            {/* Original NFT Marketplace (preserved) */}
            <Route path="/marketplace"     element={<Marketplace    />} />
            <Route path="/my-nfts"         element={<MyNFTs         />} />
            <Route path="/mint-nft"        element={<MintNFT        />} />
            <Route path="/mint-stablecoin" element={<MintStablecoin />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
