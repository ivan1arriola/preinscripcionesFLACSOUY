import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CountrySelect } from './CountrySelect.js';
import { COUNTRIES, findCountryByName, searchCountries } from '../domain/countries.js';

function Harness({ initial = '', onValue }: { initial?: string; onValue?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="pais">País de nacimiento</label>
      <CountrySelect id="pais" name="pais" value={value} onChange={(next) => { setValue(next); onValue?.(next); }} />
      <button type="button">otro</button>
    </>
  );
}

describe('countries', () => {
  it('puts Uruguay and the region first and searches without accents', () => {
    expect(COUNTRIES.slice(0, 3).map((country) => country.code)).toEqual(['UY', 'AR', 'BR']);
    expect(findCountryByName('  uruguay ')?.code).toBe('UY');
    expect(findCountryByName('mexico')?.name).toBe('México');
    expect(searchCountries('peru')[0]?.code).toBe('PE');
    expect(findCountryByName('Atlantida')).toBeUndefined();
  });
});

describe('CountrySelect', () => {
  it('lists countries with flags and selects one with a click', () => {
    const onValue = vi.fn();
    const { container } = render(<Harness onValue={onValue} />);

    fireEvent.focus(screen.getByLabelText('País de nacimiento'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(container.querySelectorAll('[role="option"] svg').length).toBeGreaterThan(10);

    fireEvent.click(screen.getByRole('option', { name: /Argentina/ }));
    expect(onValue).toHaveBeenLastCalledWith('Argentina');
    expect(screen.getByLabelText('País de nacimiento')).toHaveValue('Argentina');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('filters while typing and selects with the keyboard', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText('País de nacimiento');

    fireEvent.change(input, { target: { value: 'chi' } });
    const names = screen.getAllByRole('option').map((option) => option.textContent);
    expect(names[0]).toBe('Chile');
    expect(names).toContain('China');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValue).toHaveBeenLastCalledWith('China');
  });

  it('only keeps names from the list: an unknown text is cleared when leaving the field', async () => {
    const onValue = vi.fn();
    render(<Harness initial="Uruguay" onValue={onValue} />);
    const input = screen.getByLabelText('País de nacimiento');

    fireEvent.change(input, { target: { value: 'Atlantida' } });
    expect(onValue).toHaveBeenLastCalledWith('');
    fireEvent.blur(input);
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('accepts a country typed in full, with or without accents', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.change(screen.getByLabelText('País de nacimiento'), { target: { value: 'peru' } });
    expect(onValue).toHaveBeenLastCalledWith('Perú');
  });

  it('follows a value set from outside', () => {
    const { rerender } = render(<CountrySelect id="p" name="p" value="" onChange={() => undefined} />);
    expect(screen.getByRole('combobox')).toHaveValue('');
    rerender(<CountrySelect id="p" name="p" value="Uruguay" onChange={() => undefined} />);
    expect(screen.getByRole('combobox')).toHaveValue('Uruguay');
  });
});
