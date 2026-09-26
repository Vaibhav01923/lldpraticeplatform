import { Problem } from '../domain/problem/Problem';

export const vendingMachine = new Problem({
  id: 'vending-machine',
  title: 'Vending Machine',
  difficulty: 'medium',
  tagline: 'Behaviour that depends on what already happened — money in, product chosen, or cancelled.',
  tags: ['State', 'Strategy', 'Invariants'],
  estimatedMinutes: 40,
  context:
    'A snack vending machine sells products from numbered slots for coins and notes. What pressing a button does depends on where the customer is in the purchase, and the operator restocks and empties it.',
  requirements: [
    { id: 'R1', text: 'The machine holds products in numbered slots. Each slot has a product, a price and a quantity.' },
    { id: 'R2', text: 'Users insert coins or notes of fixed denominations. The machine tracks the running balance.' },
    { id: 'R3', text: 'A user selects a slot. If the product is in stock and the balance covers the price, the machine dispenses it and returns any change.' },
    { id: 'R4', text: 'A user may cancel before the product is dispensed and gets all inserted money back.' },
    { id: 'R5', text: 'Errors are handled sensibly: unknown slot, sold out, insufficient balance, and being unable to make exact change.' },
    { id: 'R6', text: 'An operator can restock slots and collect the money from the cash box.' },
  ],
  constraints: [
    'Selecting a product, inserting money and cancelling must each behave correctly in every situation the machine can be in.',
    'Model the machine\'s logic, not the electronics that move the product.',
  ],
  outOfScope: ['Motor and sensor hardware', 'Remote monitoring', 'Networked payment authorisation'],
  capabilities: [
    { id: 'product', label: 'Products', requirementIds: ['R1'], keywords: ['product', 'item', 'snack', 'drink'], hint: 'Something has to describe what is being sold.' },
    { id: 'slot', label: 'Slots / inventory', requirementIds: ['R1', 'R6'], keywords: ['slot', 'inventory', 'stock', 'shelf', 'rack', 'tray'], hint: 'Something has to track what is in each slot and how many are left.' },
    { id: 'money', label: 'Coins, notes and balance', requirementIds: ['R2'], keywords: ['coin', 'note', 'cash', 'money', 'denomination', 'currency', 'balance', 'credit'], hint: 'Something has to represent inserted money and the running balance.' },
    { id: 'state', label: 'Machine states', requirementIds: ['R3', 'R4', 'R5'], keywords: ['state', 'status', 'mode'], hint: 'The machine reacts differently depending on where it is in the purchase. Something has to make that explicit.' },
    { id: 'change', label: 'Change and refunds', requirementIds: ['R3', 'R4', 'R5'], keywords: ['change', 'refund', 'giver', 'maker'], hint: 'Something has to work out what to give back, and what to do when it cannot.' },
    { id: 'dispense', label: 'Dispensing', requirementIds: ['R3'], keywords: ['dispens', 'vend', 'deliver'], weight: 0.5, implicitOk: true, hint: 'Handing over the product is a step with its own preconditions.' },
    { id: 'machine', label: 'The machine itself', requirementIds: ['R1', 'R2', 'R3', 'R4'], keywords: ['machine', 'vending', 'controller'], weight: 0.5, hint: 'Something coordinates the parts and is what the user talks to.' },
    { id: 'operator', label: 'Operator actions', requirementIds: ['R6'], keywords: ['operator', 'admin', 'maintenance', 'restock', 'service'], weight: 0.5, implicitOk: true, hint: 'Restocking and collecting cash are different from a customer purchase.' },
  ],
  variabilityPoints: [
    { id: 'state', label: 'State-dependent behaviour', why: 'What insert, select and cancel do depends on the current state, and new states (out of service, maintenance) tend to appear.', keywords: ['state', 'status', 'mode'], accepts: 'abstraction-or-enum' },
    { id: 'change', label: 'Change-making policy', why: 'Giving change can be greedy, limited by the coins actually held, or minimise coin count. The policy will change.', keywords: ['change', 'refund', 'giver', 'maker'], accepts: 'abstraction' },
    { id: 'payment', label: 'Payment method', why: 'Coins today; cards and mobile wallets are the obvious next step.', keywords: ['payment', 'pay', 'wallet', 'card'], accepts: 'abstraction' },
  ],
  scenarios: [
    { id: 'S1', prompt: 'Add card and mobile-wallet payments alongside cash. What do you change and what do you add?', likelyConcepts: ['payment', 'money', 'state'] },
    { id: 'S2', prompt: 'Add a promotion: buy two, get one free on selected products. Where does that logic live?', likelyConcepts: ['product', 'slot', 'pricing'] },
    { id: 'S3', prompt: 'The machine should go out of service automatically when the cash box is full. What changes?', likelyConcepts: ['state', 'machine'] },
  ],
  hints: [
    'Write the purchase as a story: nothing inserted, money inserted, product selected, dispensing. What can the user do at each step?',
    'Ask where the rule "you can only select once you have enough money" is enforced, and whether every method has to re-check it.',
    'Change-making is its own problem. Who should know what coins the machine holds?',
  ],
  approaches: [
    {
      title: 'State pattern',
      summary: 'A VendingState interface with Idle, HasMoney, Dispensing and OutOfService implementations. The machine delegates insert, select and cancel to its current state, and states decide the next one.',
      whenItFits: 'Behaviour per state is non-trivial or new states are likely; it removes a growing if/else ladder from the machine.',
      tradeoffs: ['More classes, and transitions are spread across states.', 'Overkill if there are only two or three trivial states.'],
      patterns: ['State'],
    },
    {
      title: 'Enum state with guarded methods',
      summary: 'A single VendingMachine with a State enum and each operation checking the current value. Small and readable.',
      whenItFits: 'A handful of states with tiny behaviour differences. It is a fair choice if you can explain when you would switch to the State pattern.',
      tradeoffs: ['Every new state edits every method (against Open/Closed).', 'Easy to forget a case.'],
      patterns: ['Enum-as-type'],
    },
    {
      title: 'Separate the cash box and change-making from the machine',
      summary: 'A CoinInventory owns denominations and counts, and a ChangeStrategy (greedy, or bounded by available coins) computes what to return. The machine only asks "can you make change for X?".',
      whenItFits: 'You expect refund rules to change, or you need to test the "cannot make exact change" path in isolation.',
      tradeoffs: ['An extra abstraction to name and test.'],
      patterns: ['Strategy', 'Single responsibility'],
    },
  ],
});
