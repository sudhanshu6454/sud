import { CELEBRITY_WEB } from '../../lib/site-copy';
import { categoryLabel, type OutfitPiece } from '../../lib/spotted';
import { PieceProductTile } from './PieceProductTile';
import { SimilarRow } from './SimilarRow';
import styles from './OutfitPieces.module.css';

/**
 * The outfit piece by piece, in the editors' order: the piece's number (the
 * still's marker), its label in the owner's words and its category; then the
 * EXACT match first when one was tagged and approved, then "Similar styles"
 * as a row of alternatives. A look whose celebrity may not have a shoppable
 * page shows the pieces without products (the API sends none).
 */
export function OutfitPieces({ pieces, headingId }: { pieces: ReadonlyArray<OutfitPiece>; headingId: string }) {
  return (
    <ol className={styles.pieces} aria-labelledby={headingId}>
      {pieces.map((p, i) => (
        <li key={p.id} id={`piece-${p.id}`} className={styles.piece}>
          <div className={styles.head}>
            <span className={styles.number} aria-hidden="true">
              {i + 1}
            </span>
            <h3 className={styles.label}>
              <span className="sr-only">{i + 1}. </span>
              {p.label}
            </h3>
            <span className={styles.category}>{categoryLabel(p.category)}</span>
          </div>
          {!p.productsShown ? (
            <p className={styles.note}>{CELEBRITY_WEB.noProducts}</p>
          ) : !p.exact && p.similar.length === 0 ? (
            <p className={styles.note}>{CELEBRITY_WEB.noProductsYet}</p>
          ) : (
            <>
              {p.exact ? <PieceProductTile product={p.exact} variant="exact" /> : null}
              {p.similar.length > 0 ? (
                <div className={styles.similar}>
                  <h4 className={styles.similarTitle}>{p.similarHeading}</h4>
                  <SimilarRow className={styles.row}>
                    {p.similar.map((s) => (
                      <li key={s.id} className={styles.cell}>
                        <PieceProductTile product={s} variant="similar" />
                      </li>
                    ))}
                  </SimilarRow>
                </div>
              ) : null}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
