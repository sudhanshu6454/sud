<?php
/**
 * Validation contract shared with app/pulse-model.js (v1.7) - the numeric ranges, poll source
 * factors and industry keys the REST layer checks writes against, plus the one date helper that
 * is simple and deterministic enough to port safely.
 *
 * v1.7's compute() grew a stochastic Monte Carlo core, an industry dimension read from a table,
 * an event-calendar leg and post-release word-of-mouth inference - a hand port of that scale is
 * exactly the risk the handover itself warns against ("do not let the PHP port drift"). This
 * plugin no longer carries a PHP compute(): daily readings are produced by the pulse-worker
 * (Node), which imports pulse-model.js unchanged and posts results to
 * POST /films/{id}/readings - see class-cron.php and pulse-worker/scripts/daily-reading.js.
 *
 * @package ScreenstatPulse
 */

defined( 'ABSPATH' ) || define( 'ABSPATH', __DIR__ . '/' ); // allow running tests outside WordPress

final class SSPulse_Model {

	/** Poll sources - key => [label, enthusiasm factor]. Matches SOURCES in pulse-model.js v1.7. */
	const SOURCES = array(
		'comments' => array( 'Comment intent · auto (YouTube, your pages, Reddit)', 0.30 ),
		'story'    => array( 'Instagram story poll · 50-account batch', 0.25 ),
		'ig'       => array( 'Instagram story poll', 0.25 ),
		'yt'       => array( 'YouTube community poll', 0.28 ),
		'x'        => array( 'X poll', 0.22 ),
		'web'      => array( 'Website poll', 0.35 ),
		'exit'     => array( 'Theatre-lobby / exit sample', 0.30 ),
		'wa'       => array( 'WhatsApp / Telegram group', 0.20 ),
		'survey'   => array( 'Structured survey (random sample)', 0.80 ),
	);

	/** Industries pulse-model.js's INDUSTRY table carries; 'hindi' is the default and every legacy film. */
	const INDKEYS = array( 'hindi', 'telugu', 'tamil', 'kannada', 'malayalam', 'hollywood' );

	/**
	 * Numeric ranges (min, max) from GROUPS / RELEASE / CAL in pulse-model.js v1.7 - the validation
	 * contract every signal write is checked against. Generated from the shipped model, not retyped:
	 * see the extraction script noted in the plugin's changelog if these ever need re-deriving.
	 */
	const RANGES = array(
		'tr24'      => array( 0, 120 ),   'trTotal' => array( 0, 400 ),    'likeRatio' => array( 0, 100 ),
		'search'    => array( 0, 100 ),   'wiki'    => array( 0, 500 ),    'imdb'      => array( 0, 10000 ),
		'gsc'       => array( 0, 500 ),   'tmdb'    => array( 0, 2000 ),   'posts'     => array( 0, 1000 ),
		'net'       => array( 0, 100 ),   'official' => array( 0, 100 ),  'reddit'    => array( 0, 5000 ),
		'sentiment' => array( 0, 100 ),   'bms'     => array( 0, 3000 ),   'antic'     => array( 0, 2000 ),
		'adv'       => array( 0, 3000 ),  'song'    => array( 0, 600 ),    'spot'      => array( 0, 100 ),
		'star'      => array( 0, 100 ),   'screens' => array( 100, 6000 ), 'shows'     => array( 1, 8 ),
		'seats'     => array( 80, 400 ),  'atp'     => array( 80, 500 ),   'budget'    => array( 1, 800 ),
		'runtime'   => array( 80, 220 ),  'days'    => array( 0, 120 ),    'kInt'      => array( 0.5, 6 ),
		'bias'      => array( 0.05, 1 ),  'advShare' => array( 0.2, 0.7 ), 'advFrac'   => array( 0.2, 0.9 ),
	);

	/** Enum fields carried on signals that aren't a plain numeric range. */
	const HOLIDAY_AUTO = array( '0', '1', 'auto' );   // v1.5: holiday/comp may be 'auto' (derived from eventsFor())
	const COMP_AUTO    = array( 'none', 'moderate', 'heavy', 'auto' );
	const GENRE         = array( 'action', 'comedy', 'romance', 'drama', 'thriller', 'epic' );
	const CERT          = array( 'UA', 'A' );
	const EVENT         = array( 'none', 'leak', 'controversy', 'both' );
	const BOOL01        = array( '0', '1' );

	/** Days from today (Asia/Kolkata) to an ISO date, as the JS daysUntil() does - used by the REST
	 *  layer when a film's release date is set, and safe to keep in PHP: pure date arithmetic. */
	public static function days_until( string $iso ): int {
		$tz    = new DateTimeZone( 'Asia/Kolkata' );
		$today = new DateTime( 'today', $tz );
		$rel   = new DateTime( $iso . ' 00:00:00', $tz );
		return (int) round( ( $rel->getTimestamp() - $today->getTimestamp() ) / 86400 );
	}
}
