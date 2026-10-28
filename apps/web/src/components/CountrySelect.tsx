import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Flags from 'country-flag-icons/react/3x2';
import { findCountryByName, searchCountries, type CountryOption } from '../domain/countries.js';

type FlagComponent = React.ComponentType<{ className?: string; title?: string }>;

const Flag: React.FC<{ code: string }> = ({ code }) => {
  const Component = Flags[code as keyof typeof Flags] as FlagComponent | undefined;
  return Component ? <Component className="country-flag" /> : <span className="country-flag country-flag--empty" />;
};

export interface CountrySelectProps {
  id: string;
  name: string;
  /** Nombre del país elegido (vacío si no hay ninguno). */
  value: string;
  onChange: (name: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoComplete?: string;
}

/**
 * Selector de país con banderas y búsqueda. Solo guarda un nombre de la lista: si lo que se
 * escribió no coincide con ningún país, al salir del campo se vacía en lugar de guardar texto libre.
 */
export const CountrySelect: React.FC<CountrySelectProps> = ({
  id,
  name,
  value,
  onChange,
  onBlur,
  disabled = false,
  invalid,
  describedBy,
  autoComplete,
}) => {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [active, setActive] = useState(0);
  const lastEmitted = useRef(value);

  const emit = (next: string) => {
    lastEmitted.current = next;
    onChange(next);
  };

  // Si el valor cambia desde afuera (por ejemplo, «Uruguay» automático para la cédula), el texto lo sigue.
  // Los cambios que emite este mismo componente no pisan lo que la persona está escribiendo.
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(value);
    }
  }, [value]);

  const selected = findCountryByName(value);
  const options = useMemo(() => (open && text !== value ? searchCountries(text) : searchCountries('')), [open, text, value]);

  const choose = (country: CountryOption) => {
    setText(country.name);
    emit(country.name);
    setOpen(false);
  };

  const close = () => {
    setOpen(false);
    const match = findCountryByName(text);
    if (match) {
      if (match.name !== value) emit(match.name);
      setText(match.name);
    } else if (text !== '') {
      setText('');
      if (value !== '') emit('');
    }
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  });

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open, listId]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open && options[active]) {
      event.preventDefault();
      choose(options[active]!);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setText(value);
      setOpen(false);
    }
  };

  return (
    <div className="country-select" ref={rootRef}>
      <span className="country-select__flag" aria-hidden="true">
        {selected ? <Flag code={selected.code} /> : <span className="country-flag country-flag--empty" />}
      </span>
      <input
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        autoComplete={autoComplete ?? 'off'}
        value={text}
        disabled={disabled}
        placeholder="Buscá tu país"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
          setOpen(true);
          const match = findCountryByName(event.target.value);
          if (match) emit(match.name);
          else if (value !== '') emit('');
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // El clic en una opción llega después del blur: se espera un instante antes de cerrar.
          window.setTimeout(() => {
            if (rootRef.current?.contains(document.activeElement)) return;
            close();
            onBlur?.();
          }, 120);
        }}
      />
      <span className="country-select__chevron" aria-hidden="true">▾</span>
      {open && (
        <ul className="country-select__list" role="listbox" id={listId}>
          {options.length === 0 && <li className="country-select__empty" role="presentation">No encontramos ese país.</li>}
          {options.map((country, index) => (
            <li
              key={country.code}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={country.name === value}
              className={`country-select__option${index === active ? ' is-active' : ''}${country.name === value ? ' is-selected' : ''}`}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(country)}
              onMouseEnter={() => setActive(index)}
            >
              <Flag code={country.code} />
              <span>{country.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
