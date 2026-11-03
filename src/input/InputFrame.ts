// Минимальный контракт входа из PLAN.md §5.

export interface InputFrame {
  roll: -1 | 0 | 1; // -1 при A; +1 при D; 0 при A+D или без клавиш
  jumpHeld: boolean;
  grabHeld: boolean;
  jumpPressed: boolean; // импульс на один физический такт
}

export const emptyInputFrame = (): InputFrame => ({
  roll: 0,
  jumpHeld: false,
  grabHeld: false,
  jumpPressed: false
});
