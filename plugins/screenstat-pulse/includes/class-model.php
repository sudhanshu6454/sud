<?php
/**
 * PHP port of app/pulse-model.js — used ONLY by the daily cron (the WordPress container has no
 * Node). The JavaScript module is the reference; tests/model-equality.php asserts this port
 * reproduces it on the handover fixtures. If the two ever disagree, this file is wrong.
 *
 * @package ScreenstatPulse
 */

defined( 'ABSPATH' ) || define( 'ABSPATH', __DIR__ . '/' ); // allow running the equality test outside WordPress

final class SSPulse_Model {

	const SOURCES = array(
		'ig'     => array( 'Instagram story poll', 0.25 ),
		'yt'     => array( 'YouTube community poll', 0.28 ),
		'x'      => array( 'X poll', 0.22 ),
		'web'    => array( 'Website poll', 0.35 ),
		'exit'   => array( 'Theatre-lobby / exit sample', 0.30 ),
		'wa'     => array( 'WhatsApp / Telegram group', 0.20 ),
		'survey' => array( 'Structured survey (random sample)', 0.80 ),
	);

	/** Signal fields that carry a weight in the Buzz Index: key => [lo, hi, weight]; null anchors = pass-through. */
	const WEIGHTED = array(
		'tr24'    => array( 0.2, 60, 12 ),
		'trTotal' => array( 0.5, 150, 8 ),
		'search'  => array( null, null, 12 ),
		'posts'   => array( 1, 500, 15 ),
		'bms'     => array( 5, 1500, 25 ),
		'song'    => array( 1, 300, 8 ),
		'star'    => array( null, null, 12 ),
	);
	const LABELS = array(
		'tr24' => 'Views in first 24 h', 'trTotal' => 'Total views to date', 'search' => 'Google Trends interest',
		'posts' => 'Social posts per day', 'bms' => 'BookMyShow "interested"', 'song' => 'Top song streams/views', 'star' => 'Star pull index',
	);

	/** Numeric ranges (min, max) from GROUPS / RELEASE / CAL in pulse-model.js — the validation contract. */
	const RANGES = array(
		'tr24' => array( 0, 120 ), 'trTotal' => array( 0, 400 ), 'likeRatio' => array( 0, 100 ), 'search' => array( 0, 100 ),
		'posts' => array( 0, 1000 ), 'sentiment' => array( 0, 100 ), 'bms' => array( 0, 3000 ), 'song' => array( 0, 600 ), 'star' => array( 0, 100 ),
		'screens' => array( 100, 6000 ), 'shows' => array( 1, 8 ), 'seats' => array( 80, 400 ), 'atp' => array( 80, 500 ), 'budget' => array( 1, 800 ),
		'days' => array( 0, 120 ), 'kInt' => array( 0.5, 6 ), 'bias' => array( 0.05, 1 ),
	);

	/** JS `+x || 0` */
	private static function num( $v, float $fallback = 0.0 ): float {
		if ( is_bool( $v ) ) { return $v ? 1.0 : $fallback; }
		if ( $v === null || $v === '' ) { return $fallback; }
		if ( is_numeric( $v ) ) { $f = (float) $v; return $f == 0.0 ? $fallback : $f; }
		return $fallback;
	}
	private static function clamp( float $x, float $a, float $b ): float { return max( $a, min( $b, $x ) ); }
	private static function lognorm( float $x, float $lo, float $hi ): float { return self::clamp( 100 * log( max( $x, $lo ) / $lo ) / log( $hi / $lo ), 0, 100 ); }
	private static function sig( float $x, float $mid, float $k ): float { return 1 / ( 1 + exp( -( $x - $mid ) / $k ) ); }

	/** Days from today (Asia/Kolkata) to an ISO date, as the JS daysUntil() does. */
	public static function days_until( string $iso ): int {
		$tz    = new DateTimeZone( 'Asia/Kolkata' );
		$today = new DateTime( 'today', $tz );
		$rel   = new DateTime( $iso . ' 00:00:00', $tz );
		return (int) round( ( $rel->getTimestamp() - $today->getTimestamp() ) / 86400 );
	}

	public static function wilson( float $k, float $n, float $z = 1.96 ): array {
		if ( ! $n ) { return array( 0, 0, 0 ); }
		$p = $k / $n; $d = 1 + $z * $z / $n; $c = $p + $z * $z / ( 2 * $n ); $h = $z * sqrt( $p * ( 1 - $p ) / $n + $z * $z / ( 4 * $n * $n ) );
		return array( ( $c - $h ) / $d, $p, ( $c + $h ) / $d );
	}

	public static function pool_samples( array $samples, float $bias ): array {
		$n = 0.0; $def = 0.0; $prob = 0.0; $ott = 0.0; $no = 0.0;
		foreach ( $samples as $x ) { $n += self::num( $x['n'] ?? 0 ); $def += self::num( $x['def'] ?? 0 ); $prob += self::num( $x['prob'] ?? 0 ); $ott += self::num( $x['ott'] ?? 0 ); $no += self::num( $x['no'] ?? 0 ); }
		if ( ! $n ) { return array( 'n' => 0 ); }
		$bw = 0.0;
		foreach ( $samples as $x ) { $bw += self::num( $x['n'] ?? 0 ) * ( self::SOURCES[ $x['src'] ?? '' ][1] ?? 0.6 ); }
		$bw /= $n;
		$eff = $bias * $bw / 0.25;
		list( $lo, $p, $hi ) = self::wilson( $def, $n );
		$rate_raw = $p + 0.15 * ( $prob / $n );
		$rate_adj = self::clamp( $rate_raw * $eff, 0, 1 );
		$rel_half = $p > 0 ? ( ( $hi - $lo ) / 2 ) / $p : 1;
		return array( 'n' => $n, 'def' => $def, 'prob' => $prob, 'ott' => $ott, 'no' => $no, 'p' => $p, 'lo' => $lo, 'hi' => $hi, 'pProb' => $prob / $n, 'pOtt' => $ott / $n, 'pNo' => $no / $n,
			'rateRaw' => $rate_raw, 'rateAdj' => $rate_adj, 'eff' => $eff, 'relHalfWidth' => $rel_half, 'moe' => ( $hi - $lo ) / 2 );
	}

	/**
	 * compute(signals, samples) — field-for-field the JS function; see HANDOVER.md §5.
	 *
	 * @param array $s       Signals (string or numeric values, as stored).
	 * @param array $samples Poll samples [{src,n,def,prob,ott,no}].
	 */
	public static function compute( array $s, array $samples = array() ): array {
		if ( ! empty( $s['release'] ) ) { $s['days'] = max( 0, self::days_until( (string) $s['release'] ) ); }
		$parts = array(); $buzz = 0.0;
		foreach ( self::WEIGHTED as $k => list( $lo, $hi, $w ) ) {
			$v = self::num( $s[ $k ] ?? 0 );
			$n = $lo === null ? $v : self::lognorm( $v, $lo, $hi );
			$c = $n * $w / 100; $buzz += $c;
			$parts[] = array( 'label' => self::LABELS[ $k ], 'w' => $w, 'n' => $n, 'c' => $c );
		}
		$like_n = self::clamp( ( self::num( $s['likeRatio'] ?? 0 ) - 15 ) / 45, 0, 1 );
		$sent_n = self::clamp( ( self::num( $s['sentiment'] ?? 0 ) - 40 ) / 45, 0, 1 );
		$q = $like_n * 0.45 + $sent_n * 0.55;
		$buzz += $q * 8; $parts[] = array( 'label' => 'Quality (likes + sentiment)', 'w' => 8, 'n' => $q * 100, 'c' => $q * 8 );
		$buzz = self::clamp( $buzz, 0, 100 );

		$k_int         = self::num( $s['kInt'] ?? 0, 3.8 );
		$bms           = self::num( $s['bms'] ?? 0 );
		$bms_intent    = $bms * 1e3 * $k_int;
		$unique_aware  = self::num( $s['trTotal'] ?? 0 ) * 1e6 * 0.55 + self::num( $s['posts'] ?? 0 ) * 1e3 * 7 * 0.8;
		$interest_rate = 0.03 + 0.11 * $q;
		$reach_intent  = $unique_aware * $interest_rate;
		$intent_demand = $bms > 0 ? $bms_intent * 0.6 + $reach_intent * 0.4 : $reach_intent;
		$d1_demand     = $intent_demand * 0.40;

		$cap = self::num( $s['screens'] ?? 0 ) * self::num( $s['shows'] ?? 0 ) * self::num( $s['seats'] ?? 0 );
		$occ = 0.05 + 0.55 * self::sig( $buzz, 60, 11 );
		$hol = ( (string) ( $s['holiday'] ?? '' ) ) === '1';
		if ( $hol ) { $occ += 0.05; }
		if ( ( $s['comp'] ?? '' ) === 'moderate' ) { $occ -= 0.04; }
		if ( ( $s['comp'] ?? '' ) === 'heavy' ) { $occ -= 0.08; }
		$occ       = self::clamp( $occ, 0.04, 0.80 );
		$d1_supply = $cap * $occ;

		$smp = self::pool_samples( $samples, self::num( $s['bias'] ?? 0, 0.6 ) );
		$d1_sample = null; $intent_sample = null;
		if ( $smp['n'] > 0 ) { $intent_sample = $unique_aware * $smp['rateAdj']; $d1_sample = $intent_sample * 0.40; }

		$est = array( array( 'name' => 'Demand', 'v' => $d1_demand, 'sd' => 0.35 ), array( 'name' => 'Supply', 'v' => $d1_supply, 'sd' => 0.25 ) );
		if ( $d1_sample && $d1_sample > 0 ) { $est[] = array( 'name' => 'Audience', 'v' => $d1_sample, 'sd' => max( 0.18, $smp['relHalfWidth'] * 1.6 ) ); }
		$wsum = 0.0; $lsum = 0.0;
		foreach ( $est as &$e ) { if ( $e['v'] > 0 ) { $w = 1 / ( $e['sd'] * $e['sd'] ); $e['w'] = $w; $wsum += $w; $lsum += $w * log( $e['v'] ); } }
		unset( $e );
		foreach ( $est as &$e ) { $e['wn'] = ! empty( $e['w'] ) ? $e['w'] / $wsum : 0; }
		unset( $e );
		$d1   = exp( $lsum / $wsum );
		$vals = array(); foreach ( $est as $e ) { if ( $e['v'] > 0 ) { $vals[] = log( $e['v'] ); } }
		$spread = 0.0;
		if ( count( $vals ) > 1 ) { $acc = 0.0; $ld = log( $d1 ); foreach ( $vals as $v ) { $acc += ( $v - $ld ) ** 2; } $spread = sqrt( $acc / ( count( $vals ) - 1 ) ); }
		$sd_d1 = sqrt( 1 / $wsum + $spread * $spread * 0.5 );
		$pos   = array(); foreach ( $est as $e ) { if ( $e['v'] > 0 ) { $pos[] = $e['v']; } }
		$gap    = max( array_column( $est, 'v' ) ) / max( 1, min( $pos ) ) - 1;
		$intent = $intent_sample ? ( $intent_demand * 0.5 + $intent_sample * 0.5 ) : $intent_demand;

		$atp = self::num( $s['atp'] ?? 0, 180 );
		$wom = $q;
		$curve = static function ( float $d1v, float $w, float $atpv ) use ( $hol ): array {
			$m = array( 1.0, $hol ? ( 0.85 + 0.3 * $w ) : ( 0.95 + 0.45 * $w ) );
			$m[2] = $m[1] * ( 1.04 + 0.14 * $w ); $m[3] = $m[2] * ( 0.36 + 0.16 * $w ); $m[4] = $m[3] * ( 0.88 + 0.06 * $w ); $m[5] = $m[4] * ( 0.9 + 0.05 * $w ); $m[6] = $m[5] * ( 0.9 + 0.05 * $w );
			$days = array_map( static fn( $x ) => $d1v * $x, $m );
			$gross = array_map( static fn( $f ) => $f * $atpv / 1e7, $days );
			$week1 = array_sum( $gross ); // JS reduce((a,b)=>a+b,0): same left-to-right order
			$life_mult = 1.45 + 1.15 * $w;
			return array( 'days' => $days, 'gross' => $gross, 'week1' => $week1, 'weekend' => $gross[0] + $gross[1] + $gross[2], 'lifeMult' => $life_mult, 'life' => $week1 * $life_mult );
		};
		$base = $curve( $d1, $wom, $atp );

		// Monte Carlo — identical LCG and draw order to the JS, so readings are reproducible
		$N = 2000; $life = array(); $wk = array(); $we = array(); $d1s = array(); $day_p = array( array(), array(), array(), array(), array(), array(), array() );
		$seed = 12345;
		$rnd = static function () use ( &$seed ): float { $seed = ( $seed * 1664525 + 1013904223 ) % 4294967296; return $seed / 4294967296; };
		$gauss = static function () use ( $rnd ): float { $u = 0.0; $v = 0.0; while ( $u === 0.0 ) { $u = $rnd(); } while ( $v === 0.0 ) { $v = $rnd(); } return sqrt( -2 * log( $u ) ) * cos( 2 * M_PI * $v ); };
		for ( $i = 0; $i < $N; $i++ ) {
			$dv = $d1 * exp( $gauss() * $sd_d1 );
			$wv = self::clamp( $wom + $gauss() * 0.12, 0, 1 );
			$av = $atp * ( 1 + $gauss() * 0.07 );
			$c  = $curve( $dv, $wv, $av );
			$lm = $c['lifeMult'] * ( 1 + $gauss() * 0.12 );
			$d1s[] = $c['gross'][0]; $we[] = $c['weekend']; $wk[] = $c['week1']; $life[] = $c['week1'] * $lm;
			foreach ( $c['gross'] as $j => $g ) { $day_p[ $j ][] = $g; }
		}
		$pct = static function ( array $arr, float $p ) { sort( $arr, SORT_NUMERIC ); return $arr[ (int) floor( $p * ( count( $arr ) - 1 ) ) ]; };
		$tri = static fn( array $a ) => array( $pct( $a, .1 ), $pct( $a, .5 ), $pct( $a, .9 ) );
		$mc  = array( 'd1' => $tri( $d1s ), 'weekend' => $tri( $we ), 'week1' => $tri( $wk ), 'life' => $tri( $life ), 'days' => array_map( $tri, $day_p ) );

		$budget  = self::num( $s['budget'] ?? 0, 1 );
		$ratio   = $mc['life'][1] / $budget;
		if ( $ratio < 0.8 ) { $verdict = array( 'Flop risk', 'crit' ); }
		elseif ( $ratio < 1.1 ) { $verdict = array( 'Average', 'warn' ); }
		elseif ( $ratio < 1.5 ) { $verdict = array( 'Hit', 'good' ); }
		elseif ( $ratio < 2 ) { $verdict = array( 'Super hit', 'good' ); }
		else { $verdict = array( 'Blockbuster', 'good' ); }
		$hits = 0; foreach ( $life as $v ) { if ( $v / $budget >= 1.1 ) { $hits++; } }
		return array(
			'buzz' => $buzz, 'parts' => $parts, 'q' => $q, 'intent' => $intent, 'intentDemand' => $intent_demand, 'intentSample' => $intent_sample, 'uniqueAware' => $unique_aware,
			'interestRate' => $interest_rate, 'bmsIntent' => $bms_intent, 'reachIntent' => $reach_intent, 'd1Demand' => $d1_demand, 'd1Supply' => $d1_supply, 'd1Sample' => $d1_sample,
			'est' => $est, 'd1' => $d1, 'sdD1' => $sd_d1, 'gap' => $gap, 'cap' => $cap, 'occ' => $occ,
			'days' => $base['days'], 'gross' => array_map( static fn( $d ) => $d[1], $mc['days'] ), 'week1' => $mc['week1'][1], 'weekend' => $mc['weekend'][1], 'life' => $mc['life'][1],
			'lifeMult' => $base['lifeMult'], 'mc' => $mc, 'ratio' => $ratio, 'verdict' => $verdict, 'pHit' => $hits / $N, 'atp' => $atp, 'wom' => $wom, 'smp' => $smp, 'kInt' => $k_int,
		);
	}
}
