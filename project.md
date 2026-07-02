## Brief

I want to create a simple agent that will surface job opportunities for me. 

I want to use LinkedIn and https://www.aijobsaustralia.com.au/jobs?location=brisbane to start with

Basically what we do is we check these sites for new AI jobs that appear in Sydney, Melbourne, Brisbane

Phase 1 will just be a daily email that alerts me of these new jobs and how applicable my resume and goals are to them




## Considerations
Deduping across sources


## Error Handling
I want emails sent when
- scrapes fail 
- basically any execution error

Emails should included details about the failure. 





## Notes

- We are using the rees@fucius.ai Cloudflare account

- I can't seem to send emails from Cloudflare for free so I am going to use Resend

- The temporary email from url will be: https://vatican-ticket-notifications.com/


- Migrations are currently being handled manually (they need to be run on local)
