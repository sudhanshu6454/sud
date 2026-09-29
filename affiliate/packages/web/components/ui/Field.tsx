'use client';

import { Children, createContext, isValidElement, useContext, useId, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './Field.module.css';

interface FieldContextValue {
  id: string;
  labelId: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  /** The control is a group (the label is a <span> naming it via aria-labelledby). */
  group: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** The enclosing Field's ids, for controls that are groups (Segmented) rather than one input. */
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

/**
 * Wiring a control inside <Field> receives: its id (the label's htmlFor),
 * aria-describedby (hint / error) and aria-invalid. Input, Select, Textarea
 * and Checkbox read it; explicit props win.
 */
export function useFieldControl(props: {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
  required?: boolean;
  invalid?: boolean;
}) {
  const ctx = useContext(FieldContext);
  const invalid = props.invalid ?? (props['aria-invalid'] === true || props['aria-invalid'] === 'true');
  const fieldInvalid = ctx?.invalid ?? false;
  const describedBy = [props['aria-describedby'], ctx?.describedBy].filter(Boolean).join(' ') || undefined;
  return {
    id: props.id ?? ctx?.id,
    'aria-describedby': describedBy,
    'aria-invalid': invalid || fieldInvalid ? (true as const) : undefined,
    required: props.required ?? (ctx?.required || undefined),
    invalid: invalid || fieldInvalid,
  };
}

export interface FieldProps {
  /** Eyebrow label above the control (12px uppercase, neutral-700). */
  label: ReactNode;
  /** Appended to the label in normal case, e.g. "(optional)". */
  labelSuffix?: ReactNode;
  /** Help line under the control (12px, neutral-700; accent-700 with hintTone="accent"). */
  hint?: ReactNode;
  hintTone?: 'muted' | 'accent';
  /** Error line under the control (12px, accent-700) — also turns the control's border accent. Replaces the hint. */
  error?: ReactNode;
  required?: boolean;
  /** id for the control; generated when omitted. */
  id?: string;
  /**
   * The control is a group of inputs (Segmented, SelectableCardGroup, a set
   * of checkboxes) rather than one labelable element: the label renders as a
   * <span id> that names the group through aria-labelledby, never a
   * <label for> pointing at an id nothing carries. Detected automatically
   * when a Segmented or SelectableCardGroup is a direct child; set it when
   * the group is wrapped in something else.
   */
  group?: boolean;
  className?: string;
  children: ReactNode;
}

/** Components that are groups mark themselves with a static `fieldGroup = true`. */
function hasGroupChild(children: ReactNode): boolean {
  return Children.toArray(children).some(
    (child) =>
      isValidElement(child) &&
      typeof child.type === 'function' &&
      (child.type as { fieldGroup?: boolean }).fieldGroup === true,
  );
}

/**
 * Field: label above, control, hint or error below. The control is the child
 * (Input, Select, Textarea, or anything that calls useFieldControl()).
 */
export function Field({
  label,
  labelSuffix,
  hint,
  hintTone = 'muted',
  error,
  required = false,
  id,
  group,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? `f${generated.replace(/:/g, '')}`;
  const messageId = `${controlId}-msg`;
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const message = hasError ? error : hint;
  const hasMessage = message !== undefined && message !== null && message !== false && message !== '';
  const isGroup = group ?? hasGroupChild(children);
  const labelId = `${controlId}-label`;
  const labelContent = (
    <>
      {label}
      {labelSuffix ? <span className={styles.optional}> {labelSuffix}</span> : null}
    </>
  );

  return (
    <FieldContext.Provider
      value={{
        id: controlId,
        labelId,
        describedBy: hasMessage ? messageId : undefined,
        invalid: hasError,
        required,
        group: isGroup,
      }}
    >
      <div className={cx(styles.field, className)}>
        {isGroup ? (
          <span id={labelId} className={styles.label}>
            {labelContent}
          </span>
        ) : (
          <label id={labelId} className={styles.label} htmlFor={controlId}>
            {labelContent}
          </label>
        )}
        {children}
        {hasMessage ? (
          <p
            id={messageId}
            className={hasError ? styles.error : cx(styles.hint, hintTone === 'accent' && styles.hintAccent)}
            role={hasError ? 'alert' : undefined}
          >
            {message}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
