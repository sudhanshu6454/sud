<?php
/* Template Name: About / Contact */
get_header(); while ( have_posts() ) : the_post(); $h = get_theme_mod( 'c4_instagram', 'crazy4marketing' ); ?>
<main id="main">
<section class="page-head"><div class="grid">
	<div><span class="kicker"><?php esc_html_e( 'About', 'crazy4marketing' ); ?> · <?php esc_html_e( 'Est. 2026', 'crazy4marketing' ); ?></span><h1><?php echo has_excerpt() ? esc_html( get_the_excerpt() ) : esc_html__( 'Marketing news worth following.', 'crazy4marketing' ); ?></h1></div>
	<p class="lede"><?php bloginfo( 'description' ); ?></p>
</div></section>
<section class="page-body rule"><div class="entry-content"><?php the_content(); ?></div></section>
<section class="page-head" id="contact"><div class="grid">
	<div>
		<span class="kicker"><?php esc_html_e( 'Contact', 'crazy4marketing' ); ?></span>
		<h1 style="font-size:clamp(32px,4vw,56px)"><?php esc_html_e( 'Got a tip, a campaign, or a correction?', 'crazy4marketing' ); ?></h1>
		<p class="lede" style="margin-top:20px;font-size:16px"><a href="mailto:<?php echo esc_attr( get_option( 'admin_email' ) ); ?>"><?php echo esc_html( get_option( 'admin_email' ) ); ?></a> · <a href="<?php echo esc_url( 'https://instagram.com/' . $h ); ?>">@<?php echo esc_html( $h ); ?></a></p>
	</div>
	<?php if ( shortcode_exists( 'contact-form-7' ) || shortcode_exists( 'wpforms' ) ) : ?>
		<div class="contact-form"><?php echo do_shortcode( get_post_meta( get_the_ID(), 'c4_contact_shortcode', true ) ); ?></div>
	<?php else : ?>
		<form class="contact-form" method="post" action="mailto:<?php echo esc_attr( get_option( 'admin_email' ) ); ?>" enctype="text/plain">
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:14px"><input class="input" name="name" placeholder="<?php esc_attr_e( 'Name', 'crazy4marketing' ); ?>" required><input class="input" type="email" name="email" placeholder="<?php esc_attr_e( 'Email', 'crazy4marketing' ); ?>" required></div>
			<input class="input" name="subject" placeholder="<?php esc_attr_e( 'Subject', 'crazy4marketing' ); ?>">
			<textarea class="input" name="message" rows="6" placeholder="<?php esc_attr_e( 'Tell us in fewer words than you think you need.', 'crazy4marketing' ); ?>"></textarea>
			<button class="btn" type="submit"><?php esc_html_e( 'Send it →', 'crazy4marketing' ); ?></button>
		</form>
	<?php endif; ?>
</div></section>
</main>
<?php endwhile; get_footer();