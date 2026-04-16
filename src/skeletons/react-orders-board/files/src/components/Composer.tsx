import type { OrderDraft } from '../data';

export interface ComposerProps {
  draft: OrderDraft;
  formError: string | null;
  onFieldChange: (field: keyof OrderDraft, value: string) => void;
  onSubmit: () => void;
}

export function Composer({ draft, formError, onFieldChange, onSubmit }: ComposerProps) {
  return (
    <section className="composer">
      <div className="section-heading">
        <p className="eyebrow">New order</p>
        <h2>Queue a rush job</h2>
      </div>

      <form
        className="composer__form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="composer__grid">
          <label className="field">
            <span className="field__label">Customer</span>
            <input
              data-testid="composer-customer"
              className="field__input"
              value={draft.customer}
              onChange={(event) => onFieldChange('customer', event.target.value)}
              placeholder="Aurora Studio"
            />
          </label>

          <label className="field">
            <span className="field__label">Route</span>
            <input
              data-testid="composer-route"
              className="field__input"
              value={draft.route}
              onChange={(event) => onFieldChange('route', event.target.value)}
              placeholder="Chelsea dispatch lane"
            />
          </label>

          <label className="field">
            <span className="field__label">Owner</span>
            <input
              data-testid="composer-owner"
              className="field__input"
              value={draft.owner}
              onChange={(event) => onFieldChange('owner', event.target.value)}
              placeholder="Dispatch lead"
            />
          </label>

          <label className="field">
            <span className="field__label">Total</span>
            <input
              data-testid="composer-total"
              className="field__input"
              value={draft.total}
              onChange={(event) => onFieldChange('total', event.target.value)}
              placeholder="1840"
              inputMode="numeric"
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">Priority</span>
          <select
            data-testid="composer-priority"
            className="field__input"
            value={draft.priority}
            onChange={(event) => onFieldChange('priority', event.target.value)}
          >
            <option value="standard">Standard</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>

        <label className="field">
          <span className="field__label">Note</span>
          <textarea
            data-testid="composer-notes"
            className="field__input field__input--textarea"
            value={draft.notes}
            onChange={(event) => onFieldChange('notes', event.target.value)}
            placeholder="Anything the warehouse should know?"
            rows={3}
          />
        </label>

        {formError ? <p className="form-error">{formError}</p> : null}

        <button type="submit" className="button button--primary button--wide" data-testid="composer-submit">
          Create order
        </button>
      </form>
    </section>
  );
}
