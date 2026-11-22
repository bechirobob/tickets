const steps = ['Choose tickets', 'Processing', 'Confirmation'] as const;

export default function BookingProgress({ active }: { active: (typeof steps)[number] }) {
  return <ol className="booking-progress" aria-label="Checkout progress">
    {steps.map(step => <li key={step} aria-current={step === active ? 'step' : undefined}>{step}</li>)}
  </ol>;
}
