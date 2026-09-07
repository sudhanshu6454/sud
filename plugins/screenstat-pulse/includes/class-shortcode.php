<?php
/**
 * Public output (HANDOVER.md §8): [pulse film="slug" show="collection|buzz|intent"] and the
 * "Pulse Figure" block (server-rendered through the same function). The figure is rendered on the
 * server from the latest reading, then public/pulse-figure.js re-fetches /public/films/{slug} so a
 * page served from the cache plugin still shows today's number. Nothing renders for archived
 * (without a frozen projection) or unfilled films, and nothing is logged to the visitor.
 *
 * @package ScreenstatPulse
 */
defined( 'ABSPATH' ) || exit;

final class SSPulse_Shortcode {
	public static function init(): void {
		add_shortcode( 'pulse', array( __CLASS__, 'shortcode' ) );
		add_action( 'init', array( __CLASS__, 'block' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'register_assets' ) );
	}
	public static function register_assets(): void {
		wp_register_style( 'sspulse-figure', SSPULSE_URL . 'public/pulse-figure.css', array(), SSPULSE_VERSION );
		wp_register_script( 'sspulse-figure', SSPULSE_URL . 'public/pulse-figure.js', array(), SSPULSE_VERSION, array( 'strategy' => 'defer', 'in_footer' => true ) );
		wp_localize_script( 'sspulse-figure', 'SSPULSE_PUBLIC', array( 'restUrl' => esc_url_raw( rest_url( SSPulse_Rest::NS . '/public/films/' ) ) ) );
	}
	public static function block(): void {
		register_block_type( SSPULSE_DIR . 'public', array( 'render_callback' => static fn( $attrs ) => self::render( $attrs['film'] ?? '', $attrs['show'] ?? 'collection' ) ) );
	}
	public static function shortcode( $atts ): string {
		$a = shortcode_atts( array( 'film' => '', 'show' => 'collection' ), $atts, 'pulse' );
		return self::render( $a['film'], $a['show'] );
	}

	/** en-IN grouping (lakh/crore) with exactly two decimals, as the brand guideline §8 requires. */
	public static function fmt_in( float $v, int $dec = 2 ): string {
		$neg = $v < 0; $v = abs( $v );
		$s = number_format( $v, $dec, '.', '' ); list( $int, $frac ) = array_pad( explode( '.', $s ), 2, '' );
		if ( strlen( $int ) > 3 ) { $last3 = substr( $int, -3 ); $rest = substr( $int, 0, -3 ); $rest = preg_replace( '/\B(?=(\d{2})+(?!\d))/', ',', $rest ); $int = $rest . ',' . $last3; }
		return ( $neg ? '−' : '' ) . $int . ( $dec ? '.' . $frac : '' );
	}
	public static function fmt_cr( float $v ): string { return '₹' . self::fmt_in( $v ) . ' cr'; }
	public static function fmt_people( float $v ): string {
		if ( $v >= 1e7 ) { return self::fmt_in( $v / 1e7 ) . ' cr'; }
		if ( $v >= 1e5 ) { return self::fmt_in( $v / 1e5, 1 ) . ' lakh'; }
		return self::fmt_in( $v, 0 );
	}
	/** ▲ +1.5 / ▼ −0.8 — sign and glyph, U+2212 minus, never colour alone. */
	public static function change( float $delta, int $dec, string $unit = '' ): string {
		if ( abs( $delta ) < pow( 10, -$dec ) / 2 ) { return '<span class="ss-figure__change" aria-label="no change">— 0' . ( $dec ? '.' . str_repeat( '0', $dec ) : '' ) . $unit . '</span>'; }
		$up = $delta > 0;
		return '<span class="ss-figure__change ' . ( $up ? 'is-up' : 'is-down' ) . '">' . ( $up ? '▲ +' : '▼ −' ) . self::fmt_in( abs( $delta ), $dec ) . $unit . '</span>';
	}
	public static function ist( ?string $utc_mysql, string $fallback_date ): array {
		if ( $utc_mysql ) { $d = new DateTime( $utc_mysql, new DateTimeZone( 'UTC' ) ); $d->setTimezone( new DateTimeZone( 'Asia/Kolkata' ) ); return array( $d->format( 'c' ), $d->format( 'j M Y, H:i' ) . ' IST' ); }
		$d = new DateTime( $fallback_date, new DateTimeZone( 'Asia/Kolkata' ) ); return array( $d->format( 'Y-m-d' ), $d->format( 'j M Y' ) );
	}

	public static function render( string $slug, string $show ): string {
		$slug = sanitize_title( $slug ); $show = in_array( $show, array( 'collection', 'buzz', 'intent' ), true ) ? $show : 'collection';
		if ( ! $slug ) { return ''; }
		$p = SSPulse_Rest::public_payload( $slug );
		if ( ! $p ) { return ''; }
		$r = $p['reading']; $prev = $p['previous']; $L = $p['locked']; $A = $p['actual'];
		wp_enqueue_style( 'sspulse-figure' ); wp_enqueue_script( 'sspulse-figure' );
		$title = esc_html( $p['title'] );
		if ( $show === 'buzz' && $r ) {
			$value = self::fmt_in( $r['buzz'], 0 ); $label = "Buzz Index · $title · 0–100"; $range = ''; $chg = $prev ? self::change( $r['buzz'] - $prev['buzz'], 1 ) : '';
		} elseif ( $show === 'intent' && $r ) {
			$value = self::fmt_people( $r['intent'] ) . ' <span class="ss-figure__unit">people</span>'; $label = "Ticket intent · $title · opening weekend"; $range = ''; $chg = $prev ? self::change( ( $r['intent'] - $prev['intent'] ) / 1e5, 1, ' lakh' ) : '';
		} else {
			$life = $r ? $r['life_p50'] : ( $L['life'] ?? 0 );
			$value = self::fmt_cr( $life ) . ' <span class="ss-figure__est">est.</span>'; $label = "Projected lifetime collection · $title · India nett";
			$range = ( $r && $r['life_p10'] !== null ) ? 'P10 ' . self::fmt_cr( $r['life_p10'] ) . ' – P90 ' . self::fmt_cr( $r['life_p90'] ) : '';
			$chg = ( $prev && $r ) ? self::change( $r['life_p50'] - $prev['life_p50'], 2, ' cr' ) : '';
		}
		list( $dt_attr, $dt_text ) = self::ist( $r['recorded_at'] ?? null, $r['read_on'] ?? gmdate( 'Y-m-d' ) );
		$actual_row = '';
		if ( $L && $A && ! empty( $A['life'] ) ) {   // released/archived film: frozen projection beside the actual, both labelled
			$actual_row = '<div class="ss-figure__actual"><span>Projected at release: <b>' . self::fmt_cr( (float) $L['life'] ) . '</b></span><span>Actual: <b>' . self::fmt_cr( (float) $A['life'] ) . '</b> ' . self::change( ( (float) $L['life'] - (float) $A['life'] ) / max( 0.01, (float) $A['life'] ) * 100, 1, '%' ) . '</span></div>';
		}
		return '<figure class="ss-figure" data-sspulse="' . esc_attr( $slug ) . '" data-show="' . esc_attr( $show ) . '">'
			. '<div class="ss-figure__value">' . $value . '</div>'
			. '<div class="ss-figure__label">' . esc_html( $label ) . ( $chg ? ' · ' . $chg : '' ) . '</div>'
			. ( $range ? '<div class="ss-figure__range">' . esc_html( $range ) . '</div>' : '' )
			. $actual_row
			. '<figcaption class="ss-figure__source"><b>Source:</b> Screenstat Pulse model · India nett · est. · <time datetime="' . esc_attr( $dt_attr ) . '">' . esc_html( $dt_text ) . '</time></figcaption>'
			. '</figure>';
	}
}
