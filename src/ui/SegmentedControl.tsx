import "./SegmentedControl.css";
import { useId } from "react";

export interface Choice<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

interface SegmentedControlProps<Value extends string> {
  readonly legend: string;
  readonly choices: readonly Choice<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}

export function SegmentedControl<Value extends string>({
  legend,
  choices,
  value,
  onChange,
}: SegmentedControlProps<Value>) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">{legend}</legend>
      {choices.map((choice) => (
        <label key={choice.value}>
          <input
            type="radio"
            name={name}
            checked={choice.value === value}
            onChange={() => onChange(choice.value)}
          />
          <span>{choice.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
