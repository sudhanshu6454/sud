<?php
/**
 * Generic page (About, Editorial policy, Corrections, Contact, Privacy, Terms…).
 *
 * @package marketing-mentalist
 */

get_header();
the_post();
?>
<article style="padding:64px var(--gutter) 72px;max-width:760px">
	<h1 class="mm-h1" style="font-size:44px;margin-bottom:32px"><?php the_title(); ?></h1>
	<div class="mm-body"><?php the_content(); ?></div>
</article>
<?php get_footer(); ?>
