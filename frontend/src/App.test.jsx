import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App.jsx';

const ME = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

vi.mock('./genlayer.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    CONTRACT_ADDRESS: '0x' + 'a'.repeat(40),
    EXPLORER_URL: 'https://explorer.test/address/0x' + 'a'.repeat(40),
    STATUS: {
      OPEN: 'OPEN', ACCEPTED: 'ACCEPTED', SUBMITTED: 'SUBMITTED',
      VERIFYING: 'VERIFYING', PAID: 'PAID', FAILED: 'FAILED',
      DISPUTED: 'DISPUTED', REFUNDED: 'REFUNDED', CANCELLED: 'CANCELLED',
    },
    makeClient: () => ({}),
    listContractIds: async () => ['GL-1', 'GL-2'],
    readContractState: async (_c, id) =>
      id === 'GL-1'
        ? {
            client: ME,
            freelancer: '0xWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
            title: 'Build SaaS landing page',
            description: 'Responsive landing page, deployed publicly.',
            criteria: [
              'Landing page is publicly accessible',
              'Page includes a pricing section',
            ],
            deadline: '2026-09-30',
            budget_atto: '1500000000000000000',
            status: 'FAILED',
            evidence_urls: ['https://demo.example.com'],
            explanation: 'Deployed and pushed.',
            dispute_reason: '',
            verdict_overall: 'FAILED',
            verdict_criteria: JSON.stringify([
              { index: 1, result: 'PASS', reason: 'URL resolves' },
              { index: 2, result: 'FAIL', reason: 'No pricing section found' },
            ]),
            verdict_reasoning: 'Criteria not met.',
          }
        : {
            client: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
            freelancer: '',
            title: 'Second contract',
            description: 'Open one',
            criteria: ['Criterion A'],
            deadline: '',
            budget_atto: '500000000000000000',
            status: 'OPEN',
            evidence_urls: [],
            explanation: '',
            dispute_reason: '',
            verdict_overall: '',
            verdict_criteria: '',
            verdict_reasoning: '',
          },
    readCredit: async () => '1000000000000000000',
    writeAndWait: async () => '0x' + 'f'.repeat(64),
    parseCriteriaVerdict: orig.parseCriteriaVerdict,
  };
});

vi.mock('./WalletModal.jsx', async () => {
  const React = await import('react');
  return {
    default: function MockWallet({ me, onUnlock, onLock }) {
      if (me) {
        return React.createElement('button', { onClick: onLock }, 'Lock');
      }
      return React.createElement(
        'button',
        { onClick: () => onUnlock({ account: { address: ME } }, ME, 'wallet') },
        'connect-wallet-mock'
      );
    },
  };
});

function renderConnected() {
  const utils = render(<App />);
  fireEvent.click(screen.getByText('connect-wallet-mock'));
  return utils;
}

describe('WorkProof app', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '/marketplace';
  });

  it('renders positioning and the marketplace board', async () => {
    render(<App />);
    expect(screen.getByText('Freelance work.')).toBeTruthy();
    expect(screen.getByText('Verified by consensus.')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Build SaaS landing page')).toBeTruthy());
    expect(screen.getByText('Second contract')).toBeTruthy();
  });

  it('expands a failed contract with per-criterion results and no crash', async () => {
    renderConnected();
    fireEvent.click(await screen.findByText('Build SaaS landing page'));
    expect(await screen.findByText('VERIFICATION FAILED')).toBeTruthy();
    expect(await screen.findByText(/criteria satisfied/)).toBeTruthy();
    expect(await screen.findByText('No pricing section found')).toBeTruthy();
    // failed + client → refund + dispute options
    expect(screen.getByText('Refund escrow')).toBeTruthy();
    expect(screen.getByText('Open dispute')).toBeTruthy();
  });

  it('verification pipeline renders with conceptual label', async () => {
    renderConnected();
    fireEvent.click(await screen.findByText('Build SaaS landing page'));
    expect(await screen.findByText('Criteria evaluation')).toBeTruthy();
    expect(await screen.findByText(/Conceptual visualization/)).toBeTruthy();
  });

  it('accept action appears for open contracts', async () => {
    renderConnected();
    fireEvent.click(await screen.findByText('Second contract'));
    expect(await screen.findByText('Accept contract')).toBeTruthy();
  });

  it('create view: criteria builder, confirmation gate and preview', async () => {
    renderConnected();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByPlaceholderText(/Contract title/)).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/Contract title/), { target: { value: 'New gig' } });
    fireEvent.change(screen.getByPlaceholderText(/Describe the work/), { target: { value: 'Do the work' } });
    fireEvent.change(screen.getByPlaceholderText(/Criterion 1/), { target: { value: 'It works' } });

    const previewBtn = screen.getByText('Preview contract');
    const postBtn = screen.getByText(/Post contract & fund/);
    expect(postBtn.disabled).toBe(true); // confirmation required

    fireEvent.click(screen.getByText(/I understand that these criteria/));
    fireEvent.click(previewBtn);
    expect(await screen.findByText('Contract preview')).toBeTruthy();
    expect(screen.getByText('It works')).toBeTruthy();
  });

  it('dashboard shows computed stats and demo entry', async () => {
    renderConnected();
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(await screen.findByText('Value locked')).toBeTruthy();
    fireEvent.click(screen.getByText('View demo contract'));
    expect(await screen.findByText(/DEMO — simulated data/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByText('Build SaaS landing page').length).toBeGreaterThan(0)
    );
    await waitFor(() => expect(screen.getAllByText(/criteria satisfied/).length).toBeGreaterThan(0));
  });

  it('dispute flow UI: open dispute requires reason', async () => {
    renderConnected();
    fireEvent.click(await screen.findByText('Build SaaS landing page'));
    const btn = await screen.findByText('Open dispute');
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/State the dispute reason/), {
      target: { value: 'Pricing exists inside the accordion' },
    });
    expect(btn.disabled).toBe(false);
  });
});
