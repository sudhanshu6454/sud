<?php
/**
 * Template Name: Submit Campaign
 * Public campaign submission form (HANDOVER.md §5, §39 of the brief).
 *
 * @package marketing-mentalist
 */

get_header();
$mm_status = isset( $_GET['mm_submit'] ) ? sanitize_key( wp_unslash( $_GET['mm_submit'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
?>
<header style="padding:56px var(--gutter) 40px;max-width:900px">
	<span class="mm-kicker">For brands and agencies</span>
	<h1 class="mm-h1" style="font-size:48px;margin:8px 0 16px">Submit a campaign.</h1>
	<p class="mm-standfirst">Editorial coverage is never guaranteed. Paid options are labelled Partner Content.</p>
</header>
<div style="padding:0 var(--gutter) 24px;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:1100px">
	<?php foreach ( array(
		array( '01', 'Tell us about the work', 'Brand, agency, the idea and why it mattered. Two paragraphs is plenty.' ),
		array( '02', 'Link the assets', 'Film, stills, carousel slides, press note. Links beat uploads.' ),
		array( '03', 'Editors decide within 5 days', 'Editorial coverage is never guaranteed. Paid options are labelled Partner Content.' ),
	) as list( $n, $h, $p ) ) : ?>
		<div style="border-top:var(--rule);padding-top:12px">
			<span class="mm-kicker"><?php echo esc_html( $n ); ?></span>
			<h3 class="mm-h3" style="margin:8px 0"><?php echo esc_html( $h ); ?></h3>
			<p class="mm-body" style="font-size:15px;color:var(--mm-smoke)"><?php echo esc_html( $p ); ?></p>
		</div>
	<?php endforeach; ?>
</div>

<form id="mm-submit-campaign-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="padding:40px var(--gutter) 64px;max-width:820px;scroll-margin-top:80px">
	<input type="hidden" name="action" value="mm_submit_campaign">
	<?php wp_nonce_field( 'mm_submit_campaign', 'mm_submit_nonce' ); ?>
	<label class="screen-reader-text">Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label>

	<?php if ( 'ok' === $mm_status ) : ?>
		<div style="background:var(--mm-bone);border-top:2px solid var(--mm-signal);padding:16px;margin-bottom:24px" role="status">Thanks - an editor will be in touch within 5 days.</div>
	<?php elseif ( 'bad' === $mm_status ) : ?>
		<div style="background:var(--mm-signal-100);border-top:2px solid var(--mm-signal);padding:16px;margin-bottom:24px" role="alert">Please fill in your name, work email and the campaign name.</div>
	<?php endif; ?>

	<?php
	$mm_groups = array(
		'You' => array(
			array( 'name', 'Name', 'text', true, 'Priya Nair' ),
			array( 'company', 'Company', 'text', true, 'Talented' ),
			array( 'email', 'Work email', 'email', true, 'priya@talented.agency' ),
			array( 'phone', 'Phone', 'tel', false, '+91' ),
		),
		'The campaign' => array(
			array( 'brand', 'Brand', 'text', true, 'Zomato' ),
			array( 'agency', 'Agency', 'text', false, 'Talented' ),
			array( 'campaign_name', 'Campaign name', 'text', true, 'Before it rains' ),
			array( 'description', 'Description', 'textarea', true, 'What was the problem, the idea, and the result?' ),
			array( 'objective', 'Objective', 'text', false, 'Awareness · Consideration · Conversion' ),
			array( 'launch_date', 'Launch date', 'date', false, '' ),
			array( 'markets', 'Markets', 'text', false, 'India, UAE' ),
			array( 'credits', 'Credits', 'textarea', false, 'Roles and names' ),
		),
		'Assets' => array(
			array( 'live_url', 'Live campaign URL', 'url', false, 'https://' ),
			array( 'instagram_url', 'Instagram link', 'url', false, 'https://instagram.com/p/…' ),
			array( 'youtube_url', 'YouTube link', 'url', false, 'https://youtu.be/…' ),
			array( 'asset_url', 'Drive / asset URL', 'url', false, 'https://drive.google.com/…' ),
		),
	);
	foreach ( $mm_groups as $mm_group_name => $mm_fields ) :
		?>
		<h2 style="font-size:24px;margin:40px 0 20px;border-top:var(--hair);padding-top:20px"><?php echo esc_html( $mm_group_name ); ?></h2>
		<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px 24px">
			<?php foreach ( $mm_fields as list( $key, $label, $type, $required, $ph ) ) : ?>
				<div class="mm-field" style="<?php echo in_array( $type, array( 'textarea' ), true ) ? 'grid-column:1/-1' : ''; ?>">
					<label for="mm-<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $label ); ?><?php echo $required ? ' <span style="color:var(--mm-signal)">*</span>' : ''; ?></label>
					<?php if ( 'textarea' === $type ) : ?>
						<textarea class="mm-input" id="mm-<?php echo esc_attr( $key ); ?>" name="<?php echo esc_attr( $key ); ?>" rows="4" placeholder="<?php echo esc_attr( $ph ); ?>" <?php echo $required ? 'required' : ''; ?>></textarea>
					<?php else : ?>
						<input class="mm-input" id="mm-<?php echo esc_attr( $key ); ?>" name="<?php echo esc_attr( $key ); ?>" type="<?php echo esc_attr( $type ); ?>" placeholder="<?php echo esc_attr( $ph ); ?>" <?php echo $required ? 'required' : ''; ?>>
					<?php endif; ?>
				</div>
			<?php endforeach; ?>
		</div>
	<?php endforeach; ?>

	<button type="submit" class="mm-btn mm-btn-primary" style="margin-top:32px">Submit campaign <span aria-hidden="true">→</span></button>
</form>
<?php get_footer(); ?>
